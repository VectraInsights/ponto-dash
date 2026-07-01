from __future__ import annotations

import csv
import io
import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, flash, redirect, render_template, request, url_for

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None


IS_VERCEL = os.getenv("VERCEL") == "1"
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"

if IS_VERCEL:
    DB_PATH = "/tmp/ponto.db"
    TEMPLATE_DIR = BASE_DIR / "templates"
else:
    DB_PATH = BASE_DIR / "ponto.db"
    TEMPLATE_DIR = BASE_DIR / "templates"

DATA_FILE = BASE_DIR / "data.json"
EXPECTED_HOURS = 8

UPLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__, template_folder=str(TEMPLATE_DIR), static_folder=None)
app.secret_key = os.getenv("FLASK_SECRET", "ponto-dashboard-secret")
app.config["UPLOAD_FOLDER"] = str(UPLOAD_DIR)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


def get_db() -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"Erro ao conectar ao banco: {e}")
        raise


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                entry TEXT,
                lunch_out TEXT,
                lunch_in TEXT,
                exit_time TEXT,
                worked_minutes INTEGER DEFAULT 0,
                extra_minutes INTEGER DEFAULT 0,
                lunch_minutes INTEGER DEFAULT 0,
                status TEXT DEFAULT 'faltam_dados'
            )
            """
        )
        conn.commit()

    if DATA_FILE.exists():
        migrate_json_data()


def migrate_json_data() -> None:
    if not DATA_FILE.exists():
        return

    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        if count > 0:
            return

        with DATA_FILE.open("r", encoding="utf-8") as handle:
            entries = json.load(handle)

        for item in entries:
            conn.execute(
                """
                INSERT INTO records (date, entry, lunch_out, lunch_in, exit_time, worked_minutes, extra_minutes, lunch_minutes, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.get("date", ""),
                    item.get("entry", ""),
                    item.get("lunch_out", ""),
                    item.get("lunch_in", ""),
                    item.get("exit_time", ""),
                    item.get("worked_minutes", 0),
                    item.get("extra_minutes", 0),
                    item.get("lunch_minutes", 0),
                    item.get("status", "faltam_dados"),
                ),
            )
        conn.commit()


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
    query = "SELECT * FROM records"
    params: List[Any] = []
    if month:
        query += " WHERE substr(date, 1, 7) = ?"
        params.append(month)
    query += " ORDER BY date DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def get_monthly_series(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, int] = {}
    for item in records:
        month = item.get("date", "")[:7]
        grouped[month] = grouped.get(month, 0) + int(item.get("extra_minutes", 0))

    return [
        {"month": month, "extra_minutes": grouped[month]}
        for month in sorted(grouped)
    ]


def export_records_csv(records: List[Dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["date", "entry", "lunch_out", "lunch_in", "exit_time", "worked_minutes", "extra_minutes", "lunch_minutes", "status"])
    writer.writeheader()
    for record in records:
        writer.writerow(record)
    return output.getvalue()


def get_record(record_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    return None if row is None else dict(row)


def upsert_record(record_data: Dict[str, Any], record_id: Optional[int] = None) -> None:
    with get_db() as conn:
        if record_id is None:
            conn.execute(
                """
                INSERT INTO records (date, entry, lunch_out, lunch_in, exit_time, worked_minutes, extra_minutes, lunch_minutes, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_data["date"],
                    record_data["entry"],
                    record_data["lunch_out"],
                    record_data["lunch_in"],
                    record_data["exit_time"],
                    record_data["worked_minutes"],
                    record_data["extra_minutes"],
                    record_data["lunch_minutes"],
                    record_data["status"],
                ),
            )
        else:
            conn.execute(
                """
                UPDATE records
                SET date = ?, entry = ?, lunch_out = ?, lunch_in = ?, exit_time = ?, worked_minutes = ?, extra_minutes = ?, lunch_minutes = ?, status = ?
                WHERE id = ?
                """,
                (
                    record_data["date"],
                    record_data["entry"],
                    record_data["lunch_out"],
                    record_data["lunch_in"],
                    record_data["exit_time"],
                    record_data["worked_minutes"],
                    record_data["extra_minutes"],
                    record_data["lunch_minutes"],
                    record_data["status"],
                    record_id,
                ),
            )
        conn.commit()


def delete_record_row(record_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
        conn.commit()


def clear_all_records() -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM records")
        conn.commit()


def extract_times_from_image(file_path: str) -> Dict[str, str]:
    if not Image or not pytesseract:
        return {}

    image = Image.open(file_path)
    text = pytesseract.image_to_string(image, lang="por")
    candidates = re.findall(r"\b\d{1,2}:\d{2}\b", text)
    clean = []
    for value in candidates:
        hour, minute = map(int, value.split(":"))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            clean.append(value)

    if len(clean) < 4:
        return {}

    return {
        "entry": clean[0],
        "lunch_out": clean[1],
        "lunch_in": clean[2],
        "exit_time": clean[3],
    }


init_db()


@app.route("/", methods=["GET", "POST"])
def index():
    selected_month = request.args.get("month", "")
    records = get_records(selected_month or None)
    monthly_total = sum(item.get("extra_minutes", 0) for item in records)
    monthly_series = get_monthly_series(get_records())

    if request.method == "POST":
        file = request.files.get("image")
        if file and file.filename:
            filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}"
            file_path = UPLOAD_DIR / filename
            file.save(file_path)
            parsed = extract_times_from_image(str(file_path))
            if parsed:
                flash("Foto enviada e horários extraídos automaticamente.")
                entry = parsed["entry"]
                lunch_out = parsed["lunch_out"]
                lunch_in = parsed["lunch_in"]
                exit_time = parsed["exit_time"]
            else:
                flash("Foto enviada, mas não foi possível extrair os horários automaticamente. Você pode preencher manualmente.")
                entry = request.form.get("entry", "")
                lunch_out = request.form.get("lunch_out", "")
                lunch_in = request.form.get("lunch_in", "")
                exit_time = request.form.get("exit_time", "")
        else:
            entry = request.form.get("entry", "")
            lunch_out = request.form.get("lunch_out", "")
            lunch_in = request.form.get("lunch_in", "")
            exit_time = request.form.get("exit_time", "")

        date_value = request.form.get("date", datetime.now().strftime("%Y-%m-%d"))
        if not any([entry, lunch_out, lunch_in, exit_time]):
            flash("Informe pelo menos um horário para registrar o dia.")
            return redirect(url_for("index"))

        calculation = calculate_daily_hours(entry, lunch_out, lunch_in, exit_time)
        upsert_record(
            {
                "date": date_value,
                "entry": entry,
                "lunch_out": lunch_out,
                "lunch_in": lunch_in,
                "exit_time": exit_time,
                **calculation,
            }
        )
        flash("Registro salvo com sucesso.")
        return redirect(url_for("index"))

    if request.args.get("export") == "csv":
        response = app.response_class(
            export_records_csv(records),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=ponto-export.csv"},
        )
        return response

    return render_template(
        "index.html",
        records=records,
        monthly_total=format_minutes(monthly_total),
        expected_hours=EXPECTED_HOURS,
        edit_record=None,
        selected_month=selected_month,
        monthly_series=monthly_series,
    )


@app.route("/editar/<int:record_id>", methods=["GET", "POST"])
def edit_record(record_id: int):
    record = get_record(record_id)
    if record is None:
        flash("Registro não encontrado.")
        return redirect(url_for("index"))

    if request.method == "POST":
        file = request.files.get("image")
        entry = request.form.get("entry", "")
        lunch_out = request.form.get("lunch_out", "")
        lunch_in = request.form.get("lunch_in", "")
        exit_time = request.form.get("exit_time", "")

        if file and file.filename:
            filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}"
            file_path = UPLOAD_DIR / filename
            file.save(file_path)
            parsed = extract_times_from_image(str(file_path))
            if parsed:
                entry = parsed["entry"]
                lunch_out = parsed["lunch_out"]
                lunch_in = parsed["lunch_in"]
                exit_time = parsed["exit_time"]

        date_value = request.form.get("date", record["date"])
        if not any([entry, lunch_out, lunch_in, exit_time]):
            flash("Informe pelo menos um horário para editar o dia.")
            return redirect(url_for("edit_record", record_id=record_id))

        calculation = calculate_daily_hours(entry, lunch_out, lunch_in, exit_time)
        upsert_record(
            {
                "date": date_value,
                "entry": entry,
                "lunch_out": lunch_out,
                "lunch_in": lunch_in,
                "exit_time": exit_time,
                **calculation,
            },
            record_id=record_id,
        )
        flash("Registro atualizado com sucesso.")
        return redirect(url_for("index"))

    selected_month = request.args.get("month", "")
    records = get_records(selected_month or None)
    monthly_total = sum(item.get("extra_minutes", 0) for item in records)
    monthly_series = get_monthly_series(get_records())
    return render_template(
        "index.html",
        records=records,
        monthly_total=format_minutes(monthly_total),
        expected_hours=EXPECTED_HOURS,
        edit_record=record,
        selected_month=selected_month,
        monthly_series=monthly_series,
    )


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
