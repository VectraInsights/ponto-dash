import { createFileRoute } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Calendar, Settings2, TrendingUp, Sparkles, Download, Trash2, Upload, FileSpreadsheet } from "lucide-react";
import {
  EMPTY_ENTRY,
  MONTH_LABELS,
  WEEKDAY_LABELS,
  computeDay,
  daysInMonth,
  formatCurrency,
  formatDecimal,
  formatMinutes,
  formatMinutesAsClock,
  type DayEntry,
} from "@/lib/ponto";
import { downloadTemplate, parseImportFile } from "@/lib/ponto-xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ponto Certo — Dashboard de Cartão de Ponto" },
      {
        name: "description",
        content:
          "Registre entradas e saídas diárias, calcule horas trabalhadas e horas extras (50% em dias úteis, 100% em domingos e feriados).",
      },
    ],
  }),
  component: DashboardPage,
});

type MonthData = Record<string, DayEntry>; // key = "YYYY-MM-DD"
type Storage = {
  dailyGoalMinutes: number;
  worksSaturday: boolean;
  worksSunday: boolean;
  salary: number;
  months: Record<string, MonthData>; // key = "YYYY-MM"
};

const STORAGE_KEY = "ponto-certo:v1";

function loadStorage(): Storage {
  if (typeof window === "undefined") return { dailyGoalMinutes: 480, worksSaturday: true, worksSunday: true, salary: 0, months: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dailyGoalMinutes: 480, worksSaturday: true, worksSunday: true, salary: 0, months: {} };
    const parsed = JSON.parse(raw) as Storage;
    return {
      dailyGoalMinutes: parsed.dailyGoalMinutes ?? 480,
      worksSaturday: parsed.worksSaturday ?? true,
      worksSunday: parsed.worksSunday ?? true,
      salary: parsed.salary ?? 0,
      months: parsed.months ?? {},
    };
  } catch {
    return { dailyGoalMinutes: 480, worksSaturday: true, worksSunday: true, salary: 0, months: {} };
  }
}

function saveStorage(s: Storage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function monthKey(y: number, m: number) {
  return `${y}-${(m + 1).toString().padStart(2, "0")}`;
}
function dayKey(y: number, m: number, d: number) {
  return `${y}-${(m + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

function normalizeDateKey(dateText: string): string | null {
  const iso = /^\s*(\d{4})[-/](\d{2})[-/](\d{2})\s*$/.exec(dateText);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = /^\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})\s*$/.exec(dateText);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return null;
}

function parseTimesFromText(text: string): string[] {
  const matches = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  return matches.map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
}

function parseDateFromText(text: string, fallbackYear?: number): string | null {
  const match = text.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b|\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/);
  if (match) return normalizeDateKey(match[1] || match[2]);

  if (fallbackYear) {
    const shortMatch = text.match(/\b(\d{2})[\/\-](\d{2})\b/);
    if (shortMatch) {
      return normalizeDateKey(`${shortMatch[1]}/${shortMatch[2]}/${fallbackYear}`);
    }
  }

  return null;
}

async function parseImageFile(file: File, selectedYear: number): Promise<{ dateKey: string | null; entry: DayEntry } | null> {
  const { createWorker } = (await import("tesseract.js")) as any;
  const worker = createWorker({ logger: () => null });
  await worker.load();

  let language = "por";
  try {
    await worker.loadLanguage(language);
    await worker.initialize(language);
  } catch (err) {
    console.warn("Portuguese language failed, falling back to English", err);
    language = "eng";
    await worker.loadLanguage(language);
    await worker.initialize(language);
  }

  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const { data } = await worker.recognize(dataUrl);
  await worker.terminate();

  const text = data.text || "";
  const dateKey = parseDateFromText(text, selectedYear);
  const times = parseTimesFromText(text);

  if (times.length < 2) return null;

  const entry: DayEntry = {
    ...EMPTY_ENTRY,
    isHoliday: false,
  };

  if (times.length === 2) {
    entry.entrada1 = times[0];
    entry.saida2 = times[1];
  } else {
    entry.entrada1 = times[0] || "";
    entry.saida1 = times[1] || "";
    entry.entrada2 = times[2] || "";
    entry.saida2 = times[3] || "";
  }

  return { dateKey, entry };
}

function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(480);
  const [worksSaturday, setWorksSaturday] = useState(true);
  const [worksSunday, setWorksSunday] = useState(true);
  const [salary, setSalary] = useState(0);
  const [monthData, setMonthData] = useState<MonthData>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    const s = loadStorage();
    setDailyGoalMinutes(s.dailyGoalMinutes);
    setWorksSaturday(s.worksSaturday);
    setWorksSunday(s.worksSunday);
    setSalary(s.salary);
    setMonthData(s.months[monthKey(year, month)] ?? {});
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload month when changing year/month
  useEffect(() => {
    if (!hydrated) return;
    const s = loadStorage();
    setMonthData(s.months[monthKey(year, month)] ?? {});
  }, [year, month, hydrated]);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    const s = loadStorage();
    s.dailyGoalMinutes = dailyGoalMinutes;
    s.worksSaturday = worksSaturday;
    s.worksSunday = worksSunday;
    s.salary = salary;
    s.months[monthKey(year, month)] = monthData;
    saveStorage(s);
  }, [monthData, dailyGoalMinutes, worksSaturday, worksSunday, salary, year, month, hydrated]);

  const totalDays = daysInMonth(year, month);
  const days = useMemo(() => {
    return Array.from({ length: totalDays }, (_, i) => {
      const d = i + 1;
      const date = new Date(year, month, d);
      const key = dayKey(year, month, d);
      const entry = monthData[key] ?? EMPTY_ENTRY;
      const result = computeDay(entry, date, dailyGoalMinutes, worksSaturday, worksSunday);
      return { d, date, key, entry, result };
    });
  }, [totalDays, year, month, monthData, dailyGoalMinutes, worksSaturday, worksSunday]);

  const totals = useMemo(() => {
    let worked = 0;
    let extra50 = 0;
    let extra100 = 0;
    let expected = 0;
    for (const day of days) {
      worked += day.result.workedMinutes;
      if (day.result.multiplier === 1.5) extra50 += day.result.extraMinutes;
      if (day.result.multiplier === 2) extra100 += day.result.extraMinutes;
      const wd = day.date.getDay();
      const isHoliday = day.entry.isHoliday;
      if (!isHoliday) {
        if (wd === 6 && worksSaturday) {
          expected += dailyGoalMinutes;
        } else if (wd === 0 && worksSunday) {
          expected += dailyGoalMinutes;
        } else if (wd !== 0 && wd !== 6) {
          expected += dailyGoalMinutes;
        }
      }
    }
    const extraTotalWeighted = extra50 * 1.5 + extra100 * 2;
    return { worked, extra50, extra100, expected, extraTotalWeighted };
  }, [days, dailyGoalMinutes, worksSaturday, worksSunday]);

  function updateEntry(key: string, patch: Partial<DayEntry>) {
    setMonthData((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? EMPTY_ENTRY), ...patch },
    }));
  }

  function clearMonth() {
    if (!confirm("Limpar todos os registros deste mês?")) return;
    setMonthData({});
    toast.success("Mês limpo");
  }

  function exportCsv() {
    const totalExtra = totals.extra50 + totals.extra100;
    const rows = [
      [
        "Total Horas Extras",
        formatMinutes(totalExtra),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      ["Data", "Dia", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Trabalhado", "Extra", "Adicional", "Feriado"],
    ];
    for (const day of days) {
      const dateParts = day.key.split("-");
      const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      rows.push([
        formattedDate,
        WEEKDAY_LABELS[day.date.getDay()],
        day.entry.entrada1,
        day.entry.saida1,
        day.entry.entrada2,
        day.entry.saida2,
        formatMinutesAsClock(day.result.workedMinutes),
        formatMinutesAsClock(day.result.extraMinutes),
        day.result.multiplier === 2 ? "100%" : day.result.multiplier === 1.5 ? "50%" : "",
        day.entry.isHoliday ? "Sim" : "",
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ponto-${monthKey(year, month)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  const salaryPerHour = totals.expected > 0 ? salary / (totals.expected / 60) : 0;
  const estimatedOvertimeValue = (totals.extraTotalWeighted / 60) * salaryPerHour;

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|bmp|webp|tiff?)$/i.test(file.name);
    if (isImage) {
      toast.loading("Processando imagem...", { id: "file-import" });
      try {
          const parsed = await parseImageFile(file, year);
        }

        const s = loadStorage();
        const dateKey = parsed.dateKey ?? dayKey(year, month, new Date().getDate());
        const monthKeyFromDate = dateKey.slice(0, 7);
        s.months[monthKeyFromDate] = s.months[monthKeyFromDate] ?? {};
        s.months[monthKeyFromDate][dateKey] = parsed.entry;
        saveStorage(s);

        const [y, m] = dateKey.split("-").map(Number);
        setYear(y);
        setMonth(m - 1);
        setMonthData(s.months[monthKeyFromDate] ?? {});

        toast.success("Imagem importada com sucesso.", { id: "file-import" });
      } catch (err) {
        console.error(err);
        toast.error("Erro ao processar a imagem. Tente outra foto mais nítida.", { id: "file-import" });
      }
      return;
    }

    try {
      const rows = await parseImportFile(file);
      if (rows.length === 0) {
        toast.error("Nenhuma linha válida encontrada na planilha");
        return;
      }
      const s = loadStorage();
      let firstMonth = "";
      let count = 0;
      for (const r of rows) {
        if (!firstMonth) firstMonth = r.monthKey;
        s.months[r.monthKey] = s.months[r.monthKey] ?? {};
        s.months[r.monthKey][r.dateKey] = r.entry;
        count++;
      }
      saveStorage(s);
      // Jump to first imported month and reload
      if (firstMonth) {
        const [y, m] = firstMonth.split("-").map(Number);
        setYear(y);
        setMonth(m - 1);
        setMonthData(s.months[firstMonth] ?? {});
      } else {
        setMonthData(s.months[monthKey(year, month)] ?? {});
      }
      toast.success(`${count} lançamento(s) importado(s)`);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível ler a planilha. Verifique o formato.");
    }
  }

  const goalHours = Math.floor(dailyGoalMinutes / 60);
  const goalMins = dailyGoalMinutes % 60;

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-card)]">
              <Clock className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold text-foreground">Ponto Certo</h1>
              <p className="text-sm text-muted-foreground">
                Cartão de ponto e horas extras — dados salvos no seu navegador
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,image/*"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button variant="outline" size="sm" onClick={() => downloadTemplate()}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Baixar modelo
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Importar arquivo
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </Button>
            <Button variant="outline" size="sm" onClick={clearMonth}>
              <Trash2 className="mr-2 h-4 w-4" /> Limpar mês
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Controls */}
        <section className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="h-4 w-4" /> Período
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || year)}
                className="w-24"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Settings2 className="h-4 w-4" /> Jornada diária
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_auto] lg:grid-cols-[auto_auto_auto] items-center">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={goalHours}
                  onChange={(e) => setDailyGoalMinutes(Number(e.target.value) * 60 + goalMins)}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">h</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={goalMins}
                  onChange={(e) => setDailyGoalMinutes(goalHours * 60 + Number(e.target.value))}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Checkbox checked={worksSaturday} onCheckedChange={(value) => setWorksSaturday(!!value)} /> Trabalha sábado
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Checkbox checked={worksSunday} onCheckedChange={(value) => setWorksSunday(!!value)} /> Trabalha domingo
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                Salário mensal (R$)
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={salary}
                  onChange={(e) => setSalary(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <div className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-sm font-medium text-muted-foreground">Estimativa de horas extras</p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {formatCurrency(estimatedOvertimeValue)}
                </p>
                <p className="text-xs text-muted-foreground">Baseado na jornada e no salário informado</p>
              </div>
            </div>
          </div>
        </section>

        {/* Totals */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Trabalhado no mês" value={formatMinutes(totals.worked)} sub={`${formatDecimal(totals.worked)} h`} tone="primary" />
          <StatCard label="Extras 50% (dias úteis + sábado)" value={formatMinutes(totals.extra50)} sub={`× 1,5 = ${formatDecimal(totals.extra50 * 1.5)} h`} tone="extra" />
          <StatCard label="Extras 100% (domingo/feriado)" value={formatMinutes(totals.extra100)} sub={`× 2 = ${formatDecimal(totals.extra100 * 2)} h`} tone="holiday" />
          <StatCard label="Extras ponderadas" value={formatMinutes(totals.extraTotalWeighted)} sub={`Total pago em horas`} tone="success" icon={<TrendingUp className="h-4 w-4" />} />
        </section>

        {/* Days grid */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_120px_120px_80px] gap-2 border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground max-lg:hidden">
            <div>Dia</div>
            <div>Entrada 1</div>
            <div>Saída 1</div>
            <div>Entrada 2</div>
            <div>Saída 2</div>
            <div>Trabalhado</div>
            <div>Extra</div>
            <div>Feriado</div>
          </div>
          <ul className="divide-y divide-border">
            {days.map((day) => {
              const wd = day.date.getDay();
              const isSunday = wd === 0;
              const isSaturday = wd === 6;
              const rowTone =
                day.entry.isHoliday
                  ? "bg-[var(--color-holiday)]/40"
                  : isSunday
                    ? "bg-[var(--color-holiday)]/25"
                    : isSaturday
                      ? "bg-[var(--color-weekend)]"
                      : "";
              return (
                <li
                  key={day.key}
                  className={`grid grid-cols-2 gap-2 px-4 py-3 lg:grid-cols-[80px_1fr_1fr_1fr_1fr_120px_120px_80px] lg:items-center ${rowTone}`}
                >
                  <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
                    <span className="font-display text-lg font-semibold text-foreground">
                      {day.d.toString().padStart(2, "0")}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {WEEKDAY_LABELS[wd]}
                    </span>
                  </div>
                  <TimeField
                    label="Entrada 1"
                    value={day.entry.entrada1}
                    onChange={(v) => updateEntry(day.key, { entrada1: v })}
                  />
                  <TimeField
                    label="Saída 1"
                    value={day.entry.saida1}
                    onChange={(v) => updateEntry(day.key, { saida1: v })}
                  />
                  <TimeField
                    label="Entrada 2"
                    value={day.entry.entrada2}
                    onChange={(v) => updateEntry(day.key, { entrada2: v })}
                  />
                  <TimeField
                    label="Saída 2"
                    value={day.entry.saida2}
                    onChange={(v) => updateEntry(day.key, { saida2: v })}
                  />
                  <div className="flex items-center justify-between lg:justify-start">
                    <span className="text-xs text-muted-foreground lg:hidden">Trabalhado</span>
                    <span className="font-mono text-sm font-medium text-foreground">
                      {day.result.workedMinutes > 0 ? formatMinutes(day.result.workedMinutes) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between lg:justify-start">
                    <span className="text-xs text-muted-foreground lg:hidden">Extra</span>
                    {day.result.extraMinutes > 0 ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${
                          day.result.multiplier === 2
                            ? "bg-destructive/10 text-destructive"
                            : "bg-[var(--color-extra)]/20 text-[var(--color-extra-foreground)]"
                        }`}
                      >
                        {formatMinutes(day.result.extraMinutes)}
                        <span className="text-[10px] font-medium opacity-70">
                          {day.result.multiplier === 2 ? "100%" : "50%"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between lg:justify-start">
                    <span className="text-xs text-muted-foreground lg:hidden">Feriado</span>
                    <Checkbox
                      checked={!!day.entry.isHoliday}
                      onCheckedChange={(c) => updateEntry(day.key, { isHoliday: !!c })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <footer className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Domingos e feriados contam como 100%. Sábados e dias úteis: horas acima da jornada contam como 50%.
        </footer>
      </main>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 lg:block">
      <span className="w-20 text-xs text-muted-foreground lg:hidden">{label}</span>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 flex-1 font-mono text-sm"
      />
    </label>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "primary" | "extra" | "holiday" | "success";
  icon?: React.ReactNode;
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-primary text-primary-foreground",
    extra: "bg-[var(--color-extra)]/20 text-[var(--color-extra-foreground)]",
    holiday: "bg-destructive/10 text-destructive",
    success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
          {icon ?? <Clock className="h-3.5 w-3.5" />}
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
