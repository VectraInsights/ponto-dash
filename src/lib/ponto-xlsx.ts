import * as XLSX from "xlsx";
import { EMPTY_ENTRY, type DayEntry } from "./ponto";

export type ImportedRow = {
  dateKey: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  entry: DayEntry;
};

const HEADERS = [
  "Data",
  "Entrada 1",
  "Saída 1",
  "Entrada 2",
  "Saída 2",
  "Feriado",
];

export function downloadTemplate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();

  const rows: (string | number)[][] = [HEADERS];
  for (let d = 1; d <= days; d++) {
    const day = d.toString().padStart(2, "0");
    const monthStr = (month + 1).toString().padStart(2, "0");
    const key = `${day}/${monthStr}/${year}`;
    rows.push([key, "", "", "", "", ""]);
  }
  // Sample row
  rows[1] = [rows[1][0], "08:00", "12:00", "13:00", "17:30", ""];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ponto");

  // Instructions sheet
  const notes = [
    ["Instruções de preenchimento"],
    [""],
    ["Coluna", "Formato", "Exemplo"],
    ["Data", "DD/MM/AAAA", "01/07/2026"],
    ["Entrada 1", "HH:MM (24h)", "08:00"],
    ["Saída 1", "HH:MM (24h)", "12:00"],
    ["Entrada 2", "HH:MM (24h)", "13:00"],
    ["Saída 2", "HH:MM (24h)", "17:30"],
    ["Feriado", "Sim / Não (deixe em branco para não)", "Sim"],
    [""],
    ["Dica: para jornada única, preencha apenas Entrada 1 e Saída 2."],
  ];
  const wsNotes = XLSX.utils.aoa_to_sheet(notes);
  wsNotes["!cols"] = [{ wch: 20 }, { wch: 40 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsNotes, "Instruções");

  XLSX.writeFile(wb, "modelo-ponto.xlsx");
}

export function downloadMonthFile(filename: string, rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
  ];

  const borderStyle = {
    top: { style: "thin", color: { rgb: "FF000000" } },
    bottom: { style: "thin", color: { rgb: "FF000000" } },
    left: { style: "thin", color: { rgb: "FF000000" } },
    right: { style: "thin", color: { rgb: "FF000000" } },
  };
  const headerStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: "FFEFEFEF" } },
    border: borderStyle,
    alignment: { horizontal: "center" as const, vertical: "center" as const },
  };
  const bodyStyle = {
    border: borderStyle,
    alignment: { horizontal: "left" as const, vertical: "center" as const },
  };

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellAddress];
      if (!cell || cell.v === undefined || cell.v === "") continue;
      cell.s = R === 6 ? headerStyle : bodyStyle;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ponto");
  XLSX.writeFile(wb, filename, { bookType: "xlsx", bookSST: false, cellStyles: true });
}

function normalizeTime(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    // Excel time fraction of a day
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})[:h.](\d{2})/.exec(s);
  if (m) {
    const h = Math.min(23, Number(m[1]));
    const mi = Math.min(59, Number(m[2]));
    return `${h.toString().padStart(2, "0")}:${mi.toString().padStart(2, "0")}`;
  }
  return "";
}

function normalizeDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = (v.getMonth() + 1).toString().padStart(2, "0");
    const d = v.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + v * 86400000);
    const y = dt.getUTCFullYear();
    const m = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = dt.getUTCDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function truthy(v: unknown): boolean {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return ["sim", "s", "yes", "y", "true", "1", "x"].includes(s);
}

export async function parseImportFile(file: File): Promise<ImportedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase().includes("ponto")) ??
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: true,
  });

  const out: ImportedRow[] = [];
  for (const r of rows) {
    // Match headers case-insensitively / accent-tolerant
    const get = (keys: string[]) => {
      for (const k of Object.keys(r)) {
        const norm = k
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
        if (keys.includes(norm)) return r[k];
      }
      return "";
    };

    const dateKey = normalizeDate(get(["data", "date", "dia"]));
    if (!dateKey) continue;

    const entry: DayEntry = {
      ...EMPTY_ENTRY,
      entrada1: normalizeTime(get(["entrada 1", "entrada1", "entrada"])),
      saida1: normalizeTime(get(["saida 1", "saída 1", "saida1", "saída1"])),
      entrada2: normalizeTime(get(["entrada 2", "entrada2"])),
      saida2: normalizeTime(get(["saida 2", "saída 2", "saida2", "saída2"])),
      isHoliday: truthy(get(["feriado", "holiday"])),
    };

    out.push({
      dateKey,
      monthKey: dateKey.slice(0, 7),
      entry,
    });
  }
  return out;
}
