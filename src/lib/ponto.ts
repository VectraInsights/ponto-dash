// Utilities for time card calculation.
// Times are stored as "HH:mm" strings. Empty string means not filled.

export type DayEntry = {
  entrada1: string; // manhã in
  saida1: string; // manhã out
  entrada2: string; // tarde in
  saida2: string; // tarde out
  isHoliday?: boolean;
};

export type DailyResult = {
  workedMinutes: number;
  extraMinutes: number;
  multiplier: 1.5 | 2 | 0;
  isWeekend: boolean;
  isHoliday: boolean;
  weekday: number;
};

export const EMPTY_ENTRY: DayEntry = {
  entrada1: "",
  saida1: "",
  entrada2: "",
  saida2: "",
  isHoliday: false,
};

function toMinutes(t: string): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatMinutes(total: number): string {
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m.toString().padStart(2, "0")}`;
}

export function formatMinutesAsClock(total: number): string {
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDecimal(total: number): string {
  return (total / 60).toFixed(2).replace(".", ",");
}

export function computeDay(
  entry: DayEntry,
  date: Date,
  dailyGoalMinutes: number,
  worksSaturday: boolean,
  worksSunday: boolean,
): DailyResult {
  const weekday = date.getDay(); // 0=Sunday, 6=Saturday
  const isWeekend = weekday === 0 || weekday === 6;
  const isHoliday = !!entry.isHoliday;

  const e1 = toMinutes(entry.entrada1);
  const s1 = toMinutes(entry.saida1);
  const e2 = toMinutes(entry.entrada2);
  const s2 = toMinutes(entry.saida2);

  let worked = 0;
  if (e1 !== null && s1 !== null && s1 > e1) worked += s1 - e1;
  if (e2 !== null && s2 !== null && s2 > e2) worked += s2 - e2;

  // Fallback: single continuous shift with only entrada1 + saida2
  if (worked === 0 && e1 !== null && s2 !== null && s2 > e1 && !s1 && !e2) {
    worked = s2 - e1;
  }

  let extra = 0;
  let multiplier: 1.5 | 2 | 0 = 0;

  if (isHoliday || (weekday === 0 && worksSunday)) {
    extra = worked;
    multiplier = worked > 0 ? 2 : 0;
  } else if (weekday === 6 && worksSaturday) {
    extra = Math.max(0, worked - dailyGoalMinutes);
    multiplier = extra > 0 ? 1.5 : 0;
  } else {
    extra = Math.max(0, worked - dailyGoalMinutes);
    multiplier = extra > 0 ? 1.5 : 0;
  }

  return {
    workedMinutes: worked,
    extraMinutes: extra,
    multiplier,
    isWeekend,
    isHoliday,
    weekday,
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
