"""
Build the dashboard's database and models from the project's data files.

Run from the project root:   python pipeline/build.py

Inputs  (data/)  : lucknow_clean_2020_2025.csv   output of notebook 01 (hourly pollution + weather)
                   dash_*.csv                    outputs of notebook 02 (weather-adjusted figures)
                   lucknow_lockdown_check.csv    output of notebook 02
                   station_crosscheck_monthly.csv output of notebook 03
                   raw/*.csv                     the four raw station files used for the Nov-Dec comparison
Outputs          : db/lucknow_air.sqlite         every table the API reads
                   models/simulator.joblib       small model behind the weather simulator
                   models/model_card.json        accuracy numbers shown on the dashboard
"""
import glob
import json
import sqlite3
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import r2_score
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
DATA, DB, MODELS = ROOT / "data", ROOT / "db", ROOT / "models"
SUSPECT_START = pd.Timestamp("2025-10-20")      # evidence: station cross-check (notebook 03)

WEATHER = ["temp_c", "humidity_pct", "wind_speed", "blh_m", "pressure_hpa", "rain_mm",
           "wind_24h", "blh_24h", "rain_24h", "temp_24h", "rh_24h", "wind_72h", "rain_72h", "pressure_change_24h"]
FEATURES = WEATHER + ["hour", "month", "dow", "t"]
LABELS = {
    "temp_c": "Temperature", "humidity_pct": "Humidity", "wind_speed": "Wind speed", "blh_m": "Boundary layer height",
    "pressure_hpa": "Pressure", "rain_mm": "Rain (this hour)", "wind_24h": "Wind, last 24 h",
    "blh_24h": "Boundary layer, last 24 h", "rain_24h": "Rain, last 24 h", "temp_24h": "Temperature, last 24 h",
    "rh_24h": "Humidity, last 24 h", "wind_72h": "Wind, last 72 h", "rain_72h": "Rain, last 72 h",
    "pressure_change_24h": "Pressure change, 24 h", "hour": "Hour of day", "month": "Month",
    "dow": "Day of week", "t": "Long-term trend"}
SIM = ["month", "hour", "temp_c", "humidity_pct", "wind_speed", "blh_m", "rain_mm"]
# Physical common sense for the simulator: more wind, a deeper mixing layer or rain never raises the prediction.
MONO = [0, 0, 0, 0, -1, -1, -1]
BAND_EDGES = [0, 30, 60, 90, 120, 250, np.inf]
BAND_NAMES = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"]


def new_model(**kw):
    return HistGradientBoostingRegressor(max_iter=kw.pop("max_iter", 400), learning_rate=0.05, random_state=0, **kw)


def load_hourly():
    d = pd.read_csv(DATA / "lucknow_clean_2020_2025.csv", parse_dates=["time"], index_col="time").asfreq("h")
    d["year"], d["month"], d["hour"] = d.index.year, d.index.month, d.index.hour
    d["wind_24h"] = d["wind_speed"].rolling(24, min_periods=12).mean()
    d["blh_24h"] = d["blh_m"].rolling(24, min_periods=12).mean()
    d["rain_24h"] = d["rain_mm"].rolling(24, min_periods=12).sum()
    d["temp_24h"] = d["temp_c"].rolling(24, min_periods=12).mean()
    d["rh_24h"] = d["humidity_pct"].rolling(24, min_periods=12).mean()
    d["wind_72h"] = d["wind_speed"].rolling(72, min_periods=36).mean()
    d["rain_72h"] = d["rain_mm"].rolling(72, min_periods=36).sum()
    d["pressure_change_24h"] = d["pressure_hpa"].diff(24)
    d["dow"] = d.index.dayofweek
    d["t"] = (d.index - pd.Timestamp("2020-01-01")).total_seconds() / (365.25 * 24 * 3600)
    return d


def blocks(index):
    iso = index.isocalendar()
    return (iso.year.astype(str) + "-" + (iso.week // 2).astype(str)).to_numpy()


def cross_validate(obs, features, make):
    """Out-of-fold predictions. Whole 2-week blocks are held out together, so neighbouring hours never leak."""
    pred = np.full(len(obs), np.nan)
    for tr, te in GroupKFold(n_splits=5).split(obs, groups=blocks(obs.index)):
        m = make().fit(obs.iloc[tr][features], obs.iloc[tr]["pm25"])
        pred[te] = m.predict(obs.iloc[te][features])
    return pred


def station_compare():
    """Nov-Dec 2024 vs 2025 at both stations, computed from the raw files."""
    def read(pattern, daily):
        df = pd.concat([pd.read_csv(f, na_values=["NA"], parse_dates=["Timestamp"]) for f in sorted(glob.glob(str(DATA / "raw" / pattern)))])
        df = df.set_index("Timestamp").sort_index().rename(columns={"PM2.5 (µg/m³)": "pm25", "PM10 (µg/m³)": "pm10"})[["pm25", "pm10"]]
        df = df.mask((df <= 0) | (df >= 995))
        return df.resample("D").mean() if daily else df
    rows = []
    for name, df in [("Lalbagh", read("*site_277*1Hr.csv", True)), ("B R Ambedkar University", read("*site_5460*1D.csv", False))]:
        r = {}
        for y in (2024, 2025):
            x = df[(df.index.year == y) & df.index.month.isin([11, 12])]
            r[y] = (x["pm25"].mean(), x["pm10"].mean())
        rows.append({"station": name,
                     "pm25_2024": r[2024][0], "pm25_2025": r[2025][0], "pm10_2024": r[2024][1], "pm10_2025": r[2025][1],
                     "pm25_change_pct": (r[2025][0] / r[2024][0] - 1) * 100, "pm10_change_pct": (r[2025][1] / r[2024][1] - 1) * 100,
                     "ratio_2024": r[2024][0] / r[2024][1], "ratio_2025": r[2025][0] / r[2025][1]})
    return pd.DataFrame(rows)


def main():
    DB.mkdir(exist_ok=True)
    MODELS.mkdir(exist_ok=True)
    d = load_hourly()
    pool = d.dropna(subset=WEATHER)
    obs = pool.dropna(subset=["pm25"])
    n_before = len(obs)
    obs = obs[obs.index < SUSPECT_START].copy()
    excluded = n_before - len(obs)
    print(f"model hours: {len(obs)}  (excluded {excluded} suspect-sensor hours)")

    # ---- main model: out-of-fold predictions, accuracy, importance ----
    oof = cross_validate(obs, FEATURES, new_model)
    obs["expected"] = oof
    daily_pair = obs[["pm25", "expected"]].resample("D").mean().dropna()
    r2_hourly = r2_score(obs["pm25"], oof)
    r2_daily = r2_score(daily_pair["pm25"], daily_pair["expected"])
    tr, te = next(GroupKFold(n_splits=5).split(obs, groups=blocks(obs.index)))
    m = new_model().fit(obs.iloc[tr][FEATURES], obs.iloc[tr]["pm25"])
    imp = permutation_importance(m, obs.iloc[te][FEATURES], obs.iloc[te]["pm25"], n_repeats=5, random_state=0, scoring="r2")
    importance = pd.DataFrame({"feature": FEATURES, "label": [LABELS[f] for f in FEATURES], "importance": imp.importances_mean})
    importance = importance.sort_values("importance", ascending=False)
    print(f"R2 hourly {r2_hourly:.3f}  daily {r2_daily:.3f}")
    print(importance.head(6).round(3).to_string(index=False))

    # ---- simulator: seven inputs a visitor can set, no trend term ----
    sim_mean = lambda: new_model(max_iter=300, monotonic_cst=MONO)
    sim_pred = cross_validate(obs, SIM, sim_mean)
    r2_sim = r2_score(obs["pm25"], sim_pred)
    q = {}
    cover = {}
    for name, level in (("q10", 0.1), ("q90", 0.9)):
        make = lambda level=level: HistGradientBoostingRegressor(loss="quantile", quantile=level, max_iter=200, learning_rate=0.05, random_state=0, monotonic_cst=MONO)
        q[name] = cross_validate(obs, SIM, make)
    lo, hi = np.minimum(q["q10"], sim_pred), np.maximum(q["q90"], sim_pred)
    coverage = float(((obs["pm25"] >= lo) & (obs["pm25"] <= hi)).mean())
    print(f"simulator R2 {r2_sim:.3f}  80% interval coverage {coverage:.3f}")
    sim = {"mean": sim_mean().fit(obs[SIM], obs["pm25"]), "features": SIM}
    for name, level in (("q10", 0.1), ("q90", 0.9)):
        sim[name] = HistGradientBoostingRegressor(loss="quantile", quantile=level, max_iter=200, learning_rate=0.05, random_state=0, monotonic_cst=MONO).fit(obs[SIM], obs["pm25"])
    joblib.dump(sim, MODELS / "simulator.joblib", compress=3)
    ranges = {c: [float(obs[c].quantile(0.01)), float(obs[c].quantile(0.99))] for c in ["temp_c", "humidity_pct", "wind_speed", "blh_m", "rain_mm"]}
    ranges["rain_mm"][0] = 0.0
    card = {"hours_used": int(len(obs)), "hours_excluded": int(excluded), "r2_hourly": round(r2_hourly, 2), "r2_daily": round(r2_daily, 2),
            "sim_r2_hourly": round(r2_sim, 2), "sim_interval_coverage": round(coverage, 2), "ranges": ranges,
            "cv": "5-fold, whole 2-week blocks held out", "suspect_start": str(SUSPECT_START.date()),
            "study_start": str(obs.index.min().date()), "study_end": str(obs.index.max().date())}
    (MODELS / "model_card.json").write_text(json.dumps(card, indent=1))

    # ---- tables ----
    con_path = DB / "lucknow_air.sqlite"
    if con_path.exists():
        con_path.unlink()
    con = sqlite3.connect(con_path)
    h = d[["pm25", "pm10", "temp_c", "humidity_pct", "wind_speed", "blh_m", "rain_mm", "pressure_hpa", "year", "month", "hour"]].copy()
    h["suspect"] = (h.index >= SUSPECT_START).astype(int)
    h.loc[h["suspect"] == 1, ["pm25", "pm10"]] = np.nan
    h["expected"] = obs["expected"].reindex(h.index)
    h = h.dropna(subset=["temp_c"]).reset_index().rename(columns={"time": "ts"})
    h["ts"] = h["ts"].dt.strftime("%Y-%m-%d %H:%M")
    h.round(3).to_sql("hourly", con, index=False)
    con.execute("CREATE INDEX ix_hourly_ts ON hourly(ts)")

    dd = pd.read_csv(DATA / "dash_daily.csv").rename(columns={"pm25_raw": "pm25", "pm25_adjusted": "adjusted", "pm25_band": "band"})
    dd["expected"] = dd["date"].map(daily_pair["expected"].rename(lambda x: x.strftime("%Y-%m-%d")).round(2))
    dd.to_sql("daily", con, index=False)
    pd.read_csv(DATA / "dash_monthly.csv").to_sql("monthly", con, index=False)
    pd.read_csv(DATA / "dash_yearly.csv").to_sql("yearly", con, index=False)
    pd.read_csv(DATA / "dash_winters.csv").to_sql("winters", con, index=False)
    pd.read_csv(DATA / "lucknow_lockdown_check.csv").to_sql("lockdown", con, index=False)
    sc = pd.read_csv(DATA / "station_crosscheck_monthly.csv")
    sc["n"] = sc["n"].astype(int)
    sc.to_sql("station_slope", con, index=False)
    station_compare().round(3).to_sql("station_compare", con, index=False)
    importance.round(4).to_sql("importance", con, index=False)
    con.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT INTO meta VALUES('model_card', ?)", (json.dumps(card),))
    con.commit()
    for t in ["hourly", "daily", "monthly", "yearly", "winters", "lockdown", "station_slope", "station_compare", "importance"]:
        print(f"{t:15s}", con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0], "rows")
    con.close()
    print("database:", con_path.stat().st_size // 1024, "KB   simulator:", (MODELS / "simulator.joblib").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
