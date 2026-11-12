# Methods

## Cleaning
Zero or negative PM values, instrument-ceiling readings (PM at or above 995, CO at or above 9.99) and sensors stuck for six or more hours are blanked, not imputed. Spikes and PM2.5 above PM10 are flagged and kept, because real events such as Diwali look like errors.

## Time zones
ERA5 is in UTC and CPCB is in IST. Shifting the weather by 5h30m raised the match between ERA5 and the station's own humidity from r = 0.62 to r = 0.86.

## Model
Gradient boosting (`HistGradientBoostingRegressor`) on 14 weather and rolling-memory features, hour, month, weekday and a trend term. Five-fold cross-validation holds out whole two-week blocks, so neighbouring hours cannot leak between training and testing. R² is 0.64 hourly and 0.78 daily.

## Weather normalisation
Each hour is replayed with a weather vector drawn from the same month and hour in other years, 30 times, and averaged. The result is PM2.5 under typical weather.

## Lockdown test
The model is trained without 25 March to 31 May of the year in question and asked what that window should have been. Applying the same test to every year gives the normal error of the method (up to 22%).

## Sensor-fault check
PM2.5 is part of PM10, so the two should move together in a steady proportion. From 20 October 2025 Lalbagh's PM2.5-to-PM10 slope fell from about 0.45 to about 0.3 and its correlation weakened. A second station (B R Ambedkar University) showed no such change. The second station is an imperfect referee, so the strongest evidence is Lalbagh's PM2.5 no longer following Lalbagh's own PM10. Only the operator can confirm a fault.

## Simulator
A separate, simpler model: month, hour and five weather readings, with no trend term. More wind, a deeper mixing layer or rain can never raise its prediction. It explains 55% of hourly variation in held-out testing, and its 10th to 90th percentile range covered 75% of real hours.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/summary` | model accuracy, lockdown result, winters |
| `GET /api/winters`, `/api/yearly`, `/api/monthly`, `/api/lockdown` | the overview series |
| `GET /api/calendar?year=2024` | one row per day with its category |
| `GET /api/hour-month?year=` | mean PM2.5 by month and hour |
| `GET /api/day/{YYYY-MM-DD}` | the 24 hours of one day |
| `GET /api/expected?start=&end=` | daily measured against weather-predicted PM2.5 |
| `GET /api/blh-bins` | PM2.5 by boundary-layer-height group |
| `GET /api/importance` | permutation importance |
| `GET /api/stations` | monthly slope and correlation, plus the Nov-Dec comparison |
| `GET /api/simulate`, `/api/simulate/sweep` | simulator prediction and sensitivity curves |

Interactive API docs are at `/docs` when the app is running.
