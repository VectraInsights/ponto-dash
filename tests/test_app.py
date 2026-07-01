import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module


def test_calculate_daily_hours_extra():
    result = app_module.calculate_daily_hours("08:00", "12:00", "13:00", "19:00")
    assert result["worked_minutes"] == 600
    assert result["extra_minutes"] == 120
    assert result["status"] == "extra"


def test_calculate_daily_hours_missing():
    result = app_module.calculate_daily_hours("08:00", "12:00", "13:00", "17:00")
    assert result["worked_minutes"] == 480
    assert result["extra_minutes"] == 0
    assert result["status"] == "equilibrado"


def test_get_monthly_series_groups_by_month():
    records = [
        {"date": "2026-07-01", "extra_minutes": 60},
        {"date": "2026-07-02", "extra_minutes": 30},
        {"date": "2026-06-30", "extra_minutes": 15},
    ]
    series = app_module.get_monthly_series(records)
    assert series[0]["month"] == "2026-06"
    assert series[1]["month"] == "2026-07"


def test_export_records_csv_contains_headers():
    csv_data = app_module.export_records_csv([{"date": "2026-07-01", "entry": "08:00", "extra_minutes": 60}])
    assert "date,entry,lunch_out,lunch_in,exit_time,worked_minutes,extra_minutes,lunch_minutes,status" in csv_data
