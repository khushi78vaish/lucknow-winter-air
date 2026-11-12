from fastapi.testclient import TestClient
from app.main import app


def client():
    return TestClient(app)


def test_health_and_summary():
    with client() as c:
        assert c.get("/api/health").json()["hourly_rows"] > 50000
        s = c.get("/api/summary").json()
        assert s["model"]["hours_excluded"] == 1677
        assert s["lockdown"]["change_pct"] < -30


def test_calendar_has_no_days_after_the_sensor_fault():
    with client() as c:
        days = c.get("/api/calendar", params={"year": 2025}).json()["days"]
        assert days and max(d["date"] for d in days) < "2025-10-20"


def test_calendar_rejects_years_outside_the_study():
    with client() as c:
        assert c.get("/api/calendar", params={"year": 2019}).status_code == 422


def test_hour_month_grid_is_complete():
    with client() as c:
        cells = c.get("/api/hour-month").json()["cells"]
        assert len(cells) == 12 * 24


def test_day_drilldown_and_bad_input():
    with client() as c:
        assert len(c.get("/api/day/2024-01-10").json()["hours"]) == 24
        assert c.get("/api/day/not-a-date").status_code == 422
        assert c.get("/api/day/2031-01-01").status_code == 404


def test_blh_bins_fall_as_the_layer_deepens():
    with client() as c:
        bins = c.get("/api/blh-bins").json()
        assert len(bins) == 8 and bins[0]["pm25"] > bins[-1]["pm25"]


def test_simulator_trapped_air_is_dirtier_than_ventilated_air():
    with client() as c:
        base = dict(month=12, hour=21, temp_c=10, humidity_pct=80, wind_speed=1, rain_mm=0)
        trapped = c.get("/api/simulate", params={**base, "blh_m": 40}).json()
        open_air = c.get("/api/simulate", params={**base, "blh_m": 900}).json()
        assert trapped["pm25"] > open_air["pm25"]
        assert trapped["low"] <= trapped["pm25"] <= trapped["high"]


def test_simulator_validates_ranges():
    with client() as c:
        assert c.get("/api/simulate", params={"month": 13}).status_code == 422
        assert c.get("/api/simulate/sweep", params={"variable": "month"}).status_code == 422


def test_simulator_never_gets_dirtier_with_more_wind_or_a_deeper_layer():
    with client() as c:
        base = dict(month=12, hour=22, temp_c=9, humidity_pct=85, wind_speed=0.8, blh_m=45, rain_mm=0)
        for var in ("wind_speed", "blh_m"):
            ys = c.get("/api/simulate/sweep", params={**base, "variable": var}).json()["pm25"]
            assert all(b <= a + 1e-6 for a, b in zip(ys, ys[1:])), var
