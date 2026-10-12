/**
 * Facturas que faltan en los gastos periódicos (igual que backend/app/missing.py).
 * Series por categoría con ritmo mensual o bimestral; si traen periodo de facturación se buscan huecos entre periodos.
 */
import { addDays, dayNum, medianLow, monthIdx, monthStr, pyRound } from "./py";

export interface MRecord { category: string; day: string; period_start: string | null; period_end: string | null }
export interface Missing { month: string; category: string; cadence: number; period_from: string | null; period_to: string | null }

const MIN_GAP_DAYS = 8;
const GRACE_DAYS = 10;

function cadence(months: number[]): number | null {
  const gaps = months.slice(1).map((m, i) => m - months[i]);
  const c = medianLow(gaps);
  if (c !== 1 && c !== 2) return null;
  return gaps.filter((g) => g === c).length / gaps.length >= 0.5 ? c : null;
}

const span = (r: MRecord) => dayNum(r.period_end!) - dayNum(r.period_start!);

function periodGaps(category: string, all: MRecord[], today: string, alive: boolean): Missing[] {
  const recs = all.filter((r) => r.period_start && r.period_end)
    .sort((a, b) => a.period_start!.localeCompare(b.period_start!)); // orden estable, como sorted()
  const full = recs.map(span).filter((n) => n >= 20);
  const typical = full.length ? medianLow(full) : 30;
  const lag = Math.max(0, medianLow(recs.map((r) => dayNum(r.day) - dayNum(r.period_end!))));
  const length = (r: MRecord) => (span(r) >= 20 ? span(r) : typical);

  const out: Missing[] = [];
  let coveredTo = recs[0].period_end!;
  let prev = recs[0];
  for (const r of recs.slice(1)) {
    const gap = dayNum(r.period_start!) - dayNum(coveredTo);
    if (gap >= Math.max(MIN_GAP_DAYS, length(prev) * 0.6)) {
      const n = Math.max(1, pyRound(gap / length(prev)));
      for (let k = 1; k <= n; k++) {
        const begin = addDays(coveredTo, pyRound((gap * (k - 1)) / n));
        const end = addDays(coveredTo, pyRound((gap * k) / n));
        out.push({ month: monthStr(monthIdx(addDays(end, lag))), category, cadence: length(prev) > 45 ? 2 : 1, period_from: begin, period_to: end });
      }
    }
    if (r.period_end! > coveredTo) { coveredTo = r.period_end!; prev = r; }
  }
  if (alive) {
    const step = length(prev);
    while (dayNum(coveredTo) + step + lag + GRACE_DAYS <= dayNum(today)) {
      const begin = coveredTo;
      coveredTo = addDays(coveredTo, step);
      out.push({ month: monthStr(monthIdx(addDays(coveredTo, lag))), category, cadence: step > 45 ? 2 : 1, period_from: begin, period_to: coveredTo });
    }
  }
  // Un mes se avisa una sola vez; si le caen dos huecos, el aviso abarca las fechas de ambos
  const merged = new Map<string, Missing>();
  for (const m of out) {
    const k = `${m.month}|${m.category}|${m.cadence}`;
    const first = merged.get(k);
    merged.set(k, first ? { ...first, period_to: m.period_to! > first.period_to! ? m.period_to : first.period_to } : m);
  }
  return [...merged.values()];
}

function byPeriods(category: string, recs: MRecord[], today: string, alive: boolean): Missing[] {
  const out = periodGaps(category, recs, today, alive);
  // Un gasto sin periodo (dado de alta a mano) tapa el aviso de su mes o de uno contiguo
  const loose = recs.filter((r) => !(r.period_start && r.period_end)).sort((a, b) => a.day.localeCompare(b.day));
  for (const r of loose) {
    const m = monthIdx(r.day);
    for (const cand of [m, m - 1, m + 1]) {
      const i = out.findIndex((x) => x.month === monthStr(cand));
      if (i >= 0) { out.splice(i, 1); break; }
    }
  }
  return out;
}

export function missingInvoices(records: MRecord[], today: string): Missing[] {
  const series = new Map<string, Map<number, number>>();
  const byCat = new Map<string, MRecord[]>();
  for (const r of records) {
    const counts = series.get(r.category) ?? new Map<number, number>();
    counts.set(monthIdx(r.day), (counts.get(monthIdx(r.day)) ?? 0) + 1);
    series.set(r.category, counts);
    byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  }
  const now = monthIdx(today);
  const out: Missing[] = [];
  for (const [category, counts] of series) {
    const months = [...counts.keys()].sort((a, b) => a - b);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (months.length < 3 || total / months.length > 1.5) continue;
    const c = cadence(months);
    if (c === null) continue;
    const start = months[0], last = months.at(-1)!;
    const alive = now - last <= 3 * c;
    const recs = byCat.get(category)!;
    if (recs.filter((r) => r.period_start && r.period_end).length * 2 > recs.length) {
      out.push(...byPeriods(category, recs, today, alive));
      continue;
    }
    const end = alive ? Math.max(last, now - 1) : last;
    const expected = new Set<number>();
    for (let m = start; m <= end; m += c) expected.add(m);
    const available = new Map(counts);
    for (const m of [...expected].sort((a, b) => a - b)) {
      const cand = [m, m - 1, m + 1].find((k) => (available.get(k) ?? 0) > (k > m && expected.has(k) ? 1 : 0));
      if (cand === undefined) out.push({ month: monthStr(m), category, cadence: c, period_from: null, period_to: null });
      else available.set(cand, available.get(cand)! - 1);
    }
  }
  // sorted(set(out)): sin repetidos (mes, categoría, ritmo) y por mes y categoría
  const unique = new Map<string, Missing>();
  for (const m of out) if (!unique.has(`${m.month}|${m.category}|${m.cadence}`)) unique.set(`${m.month}|${m.category}|${m.cadence}`, m);
  return [...unique.values()].sort((a, b) => a.month.localeCompare(b.month) || cmp(a.category, b.category));
}

/** Orden de cadenas como Python (por código, no por idioma). */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
