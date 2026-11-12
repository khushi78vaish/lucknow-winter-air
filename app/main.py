"""
Lucknow Winter Air: API and static dashboard.

Every chart on the dashboard is fed by one endpoint below. The endpoints run plain SQL against
db/lucknow_air.sqlite (built by pipeline/build.py), except /api/simulate, which asks a small
scikit-learn model for a prediction.
"""
import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get("LUCKNOW_DB", ROOT / "db" / "lucknow_air.sqlite"))
MODEL_PATH = Path(os.environ.get("LUCKNOW_MODEL", ROOT / "models" / "simulator.joblib"))
STATIC = Path(__file__).resolve().parent / "static"

BANDS = [  # CPCB categories for a 24-hour average of PM2.5, ug/m3
    {"name": "Good", "lo": 0, "hi": 30},
    {"name": "Satisfactory", "lo": 31, "hi": 60},
    {"name": "Moderate", "lo": 61, "hi": 90},
    {"name": "Poor", "lo": 91, "hi": 120},
    {"name": "Very poor", "lo": 121, "hi": 250},
    {"name": "Severe", "lo": 251, "hi": None},
]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def band_index(v: float) -> int:
    for i, edge in enumerate([30, 60, 90, 120, 250]):
        if v <= edge:
            return i
    return 5


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sim = joblib.load(MODEL_PATH)
    yield


app = FastAPI(title="Lucknow Winter Air", version="1.0", lifespan=lifespan)


def query(sql: str, params: tuple = ()) -> list[dict]:
    uri = f"file:{DB_PATH}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as con:
        con.row_factory = sqlite3.Row
        return [dict(r) for r in con.execute(sql, params).fetchall()]


def clean(rows: list[dict]) -> list[dict]:
    """JSON cannot hold NaN; SQLite hands back None for missing values already, this is a safety net."""
    return [{k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in r.items()} for r in rows]


def model_card() -> dict:
    return json.loads(query("SELECT value FROM meta WHERE key='model_card'")[0]["value"])


@app.get("/api/health")
def health():
    n = query("SELECT COUNT(*) AS n FROM hourly")[0]["n"]
    return {"status": "ok", "hourly_rows": n}


@app.get("/api/summary")
def summary():
    card = model_card()
    lock = query("SELECT * FROM lockdown WHERE year=2020")[0]
    winters = query("SELECT * FROM winters ORDER BY winter")
    return {"model": card, "bands": BANDS, "lockdown": lock, "winters": winters,
            "lockdown_error_pct": max(abs(r["change_pct"]) for r in query("SELECT change_pct FROM lockdown WHERE year<>2020"))}


@app.get("/api/winters")
def winters():
    return query("SELECT winter, raw, weather_adjusted AS adjusted FROM winters ORDER BY winter")


@app.get("/api/yearly")
def yearly():
    return query("SELECT year, raw, weather_adjusted AS adjusted FROM yearly ORDER BY year")


@app.get("/api/monthly")
def monthly():
    return query("SELECT substr(month,1,7) AS month, raw, weather_adjusted AS adjusted FROM monthly ORDER BY month")


@app.get("/api/lockdown")
def lockdown():
    return query("SELECT year, measured, expected, change_pct FROM lockdown ORDER BY year")


@app.get("/api/calendar")
def calendar(year: int = Query(..., ge=2020, le=2025)):
    rows = query("SELECT date, pm25, hours, band FROM daily WHERE date BETWEEN ? AND ? ORDER BY date", (f"{year}-01-01", f"{year}-12-31"))
    counts = {}
    for r in rows:
        counts[r["band"]] = counts.get(r["band"], 0) + 1
    return {"year": year, "days": rows, "counts": counts, "bands": BANDS}


@app.get("/api/hour-month")
def hour_month(year: int | None = Query(None, ge=2020, le=2025)):
    where, params = ("AND year = ?", (year,)) if year else ("", ())
    rows = query(f"SELECT month, hour, ROUND(AVG(pm25),1) AS pm25, COUNT(*) AS n FROM hourly WHERE pm25 IS NOT NULL {where} GROUP BY month, hour ORDER BY month, hour", params)
    return {"year": year, "cells": rows}


@app.get("/api/day/{date}")
def day(date: str):
    if not DATE_RE.match(date):
        raise HTTPException(422, "Use the format YYYY-MM-DD")
    rows = query("SELECT hour, pm25, expected, blh_m, wind_speed, temp_c FROM hourly WHERE substr(ts,1,10)=? ORDER BY ts", (date,))
    if not rows:
        raise HTTPException(404, "No data for that date")
    return {"date": date, "hours": clean(rows)}


@app.get("/api/expected")
def expected(start: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), end: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    rows = query("SELECT date, pm25, expected FROM daily WHERE date BETWEEN ? AND ? AND expected IS NOT NULL ORDER BY date", (start, end))
    return {"days": clean(rows)}


@app.get("/api/blh-bins")
def blh_bins():
    return query("""
        WITH w AS (SELECT blh_m, pm25 FROM hourly WHERE month IN (11,12,1) AND pm25 IS NOT NULL),
             r AS (SELECT blh_m, pm25, NTILE(8) OVER (ORDER BY blh_m) AS bin FROM w)
        SELECT bin, ROUND(MIN(blh_m)) AS lo, ROUND(MAX(blh_m)) AS hi, ROUND(AVG(pm25),1) AS pm25, COUNT(*) AS n
        FROM r GROUP BY bin ORDER BY bin""")


@app.get("/api/importance")
def importance(top: int = Query(8, ge=1, le=18)):
    return query("SELECT label, ROUND(importance,3) AS importance FROM importance ORDER BY importance DESC LIMIT ?", (top,))


@app.get("/api/stations")
def stations():
    slope = query("SELECT station, month, slope, corr, n FROM station_slope ORDER BY station, month")
    return {"slope": slope, "compare": query("SELECT * FROM station_compare"), "fault_start": "2025-10-20", "usual_range": [0.40, 0.52]}


# ---------------- simulator ----------------
def sim_frame(month, hour, temp_c, humidity_pct, wind_speed, blh_m, rain_mm, sweep=None):
    base = dict(month=month, hour=hour, temp_c=temp_c, humidity_pct=humidity_pct, wind_speed=wind_speed, blh_m=blh_m, rain_mm=rain_mm)
    if sweep is None:
        return pd.DataFrame([base])
    var, values = sweep
    df = pd.DataFrame([base] * len(values))
    df[var] = values
    return df


def predict(df):
    sim = app.state.sim
    X = df[sim["features"]]
    mean, q10, q90 = sim["mean"].predict(X), sim["q10"].predict(X), sim["q90"].predict(X)
    mean = np.clip(mean, 1, None)
    return mean, np.clip(np.minimum(q10, mean), 1, None), np.maximum(q90, mean)


INPUTS = dict(month=Query(12, ge=1, le=12), hour=Query(21, ge=0, le=23), temp_c=Query(10.0, ge=-5, le=50),
              humidity_pct=Query(80.0, ge=0, le=100), wind_speed=Query(1.0, ge=0, le=15),
              blh_m=Query(60.0, ge=0, le=3500), rain_mm=Query(0.0, ge=0, le=30))


@app.get("/api/simulate")
def simulate(month: int = INPUTS["month"], hour: int = INPUTS["hour"], temp_c: float = INPUTS["temp_c"],
             humidity_pct: float = INPUTS["humidity_pct"], wind_speed: float = INPUTS["wind_speed"],
             blh_m: float = INPUTS["blh_m"], rain_mm: float = INPUTS["rain_mm"]):
    mean, lo, hi = predict(sim_frame(month, hour, temp_c, humidity_pct, wind_speed, blh_m, rain_mm))
    v = float(mean[0])
    return {"pm25": round(v, 1), "low": round(float(lo[0]), 1), "high": round(float(hi[0]), 1),
            "band": BANDS[band_index(v)]["name"], "band_index": band_index(v)}


@app.get("/api/simulate/sweep")
def sweep(variable: str = Query(..., pattern="^(blh_m|wind_speed)$"), month: int = INPUTS["month"], hour: int = INPUTS["hour"],
          temp_c: float = INPUTS["temp_c"], humidity_pct: float = INPUTS["humidity_pct"], wind_speed: float = INPUTS["wind_speed"],
          blh_m: float = INPUTS["blh_m"], rain_mm: float = INPUTS["rain_mm"]):
    lo, hi = model_card()["ranges"][variable]
    values = np.round(np.linspace(lo, hi, 40), 2)
    mean, _, _ = predict(sim_frame(month, hour, temp_c, humidity_pct, wind_speed, blh_m, rain_mm, (variable, values)))
    return {"variable": variable, "x": values.tolist(), "pm25": np.round(mean, 1).tolist()}


@app.exception_handler(sqlite3.Error)
async def db_error(request, exc):
    return JSONResponse({"detail": "Database unavailable. Run python pipeline/build.py first."}, status_code=500)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
