from __future__ import annotations

import csv
import io
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, flash, redirect, render_template, request, url_for

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
EXPECTED_HOURS = 8

app = Flask(__name__, template_folder=str(TEMPLATE_DIR), static_folder=None)
app.secret_key = os.getenv("FLASK_SECRET", "ponto-dashboard-secret")

# Armazenamento em memória para Vercel serverless
IN_MEMORY_RECORDS: List[Dict[str, Any]] = []


def parse_time(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%H:%M")
    except ValueError:
        return None


def calculate_daily_hours(entry: str, lunch_out: str, lunch_in: str, exit_time: str) -> Dict[str, Any]:
    entry_dt = parse_time(entry)
    lunch_out_dt = parse_time(lunch_out)
    lunch_in_dt = parse_time(lunch_in)
    exit_dt = parse_time(exit_time)

    if not all([entry_dt, lunch_out_dt, lunch_in_dt, exit_dt]):
        return {"worked_minutes": 0, "extra_minutes": 0, "status": "faltam_dados"}

    lunch_minutes = int((lunch_in_dt - lunch_out_dt).total_seconds() // 60)
    worked_minutes = int((exit_dt - entry_dt).total_seconds() // 60) - lunch_minutes
    expected_minutes = EXPECTED_HOURS * 60
    extra_minutes = worked_minutes - expected_minutes

    if extra_minutes > 0:
        status = "extra"
    elif extra_minutes < 0:
        status = "faltando"
    else:
        status = "equilibrado"

    return {
        "worked_minutes": worked_minutes,
        "extra_minutes": extra_minutes,
        "status": status,
        "lunch_minutes": lunch_minutes,
    }


def format_minutes(minutes: int) -> str:
    sign = "+" if minutes >= 0 else "-"
    minutes = abs(minutes)
    hours, mins = divmod(minutes, 60)
    return f"{sign}{hours:02d}h{mins:02d}m"


def get_records(month: Optional[str] = None) -> List[Dict[str, Any]]:
    filtered = IN_MEMORY_RECORDS
    if month:
        filtered = [r for r in filtered if r.get("date", "").startswith(month)]
    return sorted(filtered, key=lambda x: x.get("date", ""), reverse=True)


def get_record(record_id: int) -> Optional[Dict[str, Any]]:
    for record in IN_MEMORY_RECORDS:
        if record.get("id") == record_id:
            return record
    return None


def upsert_record(record_data: Dict[str, Any], record_id: Optional[int] = None) -> None:
    global IN_MEMORY_RECORDS
    if record_id is None:
        new_id = max((r.get("id", 0) for r in IN_MEMORY_RECORDS), default=0) + 1
        record_data["id"] = new_id
        IN_MEMORY_RECORDS.append(record_data)
    else:
        for i, record in enumerate(IN_MEMORY_RECORDS):
            if record.get("id") == record_id:
                IN_MEMORY_RECORDS[i] = {**record_data, "id": record_id}
                break


def delete_record_row(record_id: int) -> None:
    global IN_MEMORY_RECORDS
    IN_MEMORY_RECORDS = [r for r in IN_MEMORY_RECORDS if r.get("id") != record_id]


def clear_all_records() -> None:
    global IN_MEMORY_RECORDS
    IN_MEMORY_RECORDS = []


def get_monthly_series(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, int] = {}
    for item in records:
        month = item.get("date", "")[:7]
        grouped[month] = grouped.get(month, 0) + int(item.get("extra_minutes", 0))

    return [{"month": month, "extra_minutes": grouped[month]} for month in sorted(grouped)]


def export_records_csv(records: List[Dict[str, Any]]) -> str:
    output = io.StringIO()
    fieldnames = ["id", "date", "entry", "lunch_out", "lunch_in", "exit_time", "worked_minutes", "extra_minutes", "lunch_minutes", "status"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for record in records:
        filtered_record = {k: v for k, v in record.items() if k in fieldnames}
        writer.writerow(filtered_record)
    return output.getvalue()


@app.route("/", methods=["GET", "POST"])
def index():
    selected_month = request.args.get("month", "")
    records = get_records(selected_month or None)
    monthly_total = sum(item.get("extra_minutes", 0) for item in records)
    monthly_series = get_monthly_series(get_records())

    if request.method == "POST":
        entry = request.form.get("entry", "")
        lunch_out = request.form.get("lunch_out", "")
        lunch_in = request.form.get("lunch_in", "")
        exit_time = request.form.get("exit_time", "")

        date_value = request.form.get("date", datetime.now().strftime("%Y-%m-%d"))
        if not any([entry, lunch_out, lunch_in, exit_time]):
            flash("Informe pelo menos um horário para registrar o dia.")
            return redirect(url_for("index"))

        calculation = calculate_daily_hours(entry, lunch_out, lunch_in, exit_time)
        upsert_record({"date": date_value, "entry": entry, "lunch_out": lunch_out, "lunch_in": lunch_in, "exit_time": exit_time, **calculation})
        flash("Registro salvo com sucesso.")
        return redirect(url_for("index"))

    if request.args.get("export") == "csv":
        response = app.response_class(export_records_csv(records), mimetype="text/csv", headers={"Content-Disposition": "attachment;filename=ponto-export.csv"})
        return response

    return render_template("index.html", records=records, monthly_total=format_minutes(monthly_total), expected_hours=EXPECTED_HOURS, edit_record=None, selected_month=selected_month, monthly_series=monthly_series)


@app.route("/editar/<int:record_id>", methods=["GET", "POST"])
def edit_record(record_id: int):
    record = get_record(record_id)
    if record is None:
        flash("Registro não encontrado.")
        return redirect(url_for("index"))

    if request.method == "POST":
        entry = request.form.get("entry", "")
        lunch_out = request.form.get("lunch_out", "")
        lunch_in = request.form.get("lunch_in", "")
        exit_time = request.form.get("exit_time", "")
        date_value = request.form.get("date", record["date"])

        if not any([entry, lunch_out, lunch_in, exit_time]):
            flash("Informe pelo menos um horário para editar o dia.")
            return redirect(url_for("edit_record", record_id=record_id))

        calculation = calculate_daily_hours(entry, lunch_out, lunch_in, exit_time)
        upsert_record({"date": date_value, "entry": entry, "lunch_out": lunch_out, "lunch_in": lunch_in, "exit_time": exit_time, **calculation}, record_id=record_id)
        flash("Registro atualizado com sucesso.")
        return redirect(url_for("index"))

    selected_month = request.args.get("month", "")
    records = get_records(selected_month or None)
    monthly_total = sum(item.get("extra_minutes", 0) for item in records)
    monthly_series = get_monthly_series(get_records())
    return render_template("index.html", records=records, monthly_total=format_minutes(monthly_total), expected_hours=EXPECTED_HOURS, edit_record=record, selected_month=selected_month, monthly_series=monthly_series)


@app.route("/deletar/<int:record_id>", methods=["POST"])
def delete_record_route(record_id: int):
    record = get_record(record_id)
    if record is not None:
        delete_record_row(record_id)
        flash("Registro removido com sucesso.")
    else:
        flash("Registro não encontrado.")
    return redirect(url_for("index"))


@app.route("/limpar", methods=["POST"])
def clear_records_route():
    clear_all_records()
    flash("Todos os registros foram removidos.")
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
