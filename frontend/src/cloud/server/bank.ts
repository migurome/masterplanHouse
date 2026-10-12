/**
 * Movimientos bancarios desde Excel (igual que backend/app/bank.py): tipo de movimiento, categoría sugerida,
 * huella (la misma que calculaba Python, para reconocer lo ya importado) y cotejo con los gastos registrados.
 */
import { expenseMerchant, merchantKey } from "./merchants";
import { missingInvoices } from "./missing";
import { addDays, dayNum, fold, monthIdx, pyRound, today as todayIso } from "./py";
import { CATEGORY_RULES } from "./rules";
import { Cell, ExcelDate, pyStr, readXlsx, XlsxError, XNum } from "./xlsx";

export class BankFileError extends Error {}

export const CARD = "Pagos con tarjeta";
export const DEBIT = "Recibos domiciliados";
export const INTERNAL = "Traspasos entre cuentas";
export const TRANSFER = "Transferencias";
export const CASH = "Retiradas de efectivo";
export const BIZUM = "Bizum";
export const INCOME = "Ingresos y devoluciones";
export const OTHER = "Otros movimientos";
export const DEFAULT_EXCLUDED = [INTERNAL, TRANSFER, CASH, INCOME];

export const INC_MONTHLY = "Aportaciones mensuales";
export const INC_TRANSFER = "Transferencias y reembolsos";
export const INC_CASH = "Ingresos en efectivo";
export const INC_BIZUM = "Bizum recibidos";
export const INC_REFUND = "Devoluciones de compras";
export const INCOME_KINDS = [INC_MONTHLY, INC_TRANSFER, INC_CASH, INC_BIZUM, INC_REFUND];
export const DEFAULT_EXCLUDED_INCOME = [INC_REFUND];
export const SETTING_KEY = "bank_excluded_kinds";
export const INCOME_SETTING_KEY = "bank_excluded_income_kinds";
export const LEARNED_KEY = "bank_category_by_group";

const MONTH_WORDS = new Set(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "sept",
  "octubre", "noviembre", "diciembre", "ene", "feb", "mar", "abr", "jun", "jul", "ago", "sep", "oct", "nov", "dic", "aporte", "aportacion"]);
const MONTH_NUM: Record<string, number> = { enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11,
  nov: 11, diciembre: 12, dic: 12 };
// Meses que entiende parse_date de Python (backend/app/parsers/base.py)
const PARSE_MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, january: 1, february: 2, march: 3, april: 4, may: 5,
  june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, ene: 1, feb: 2, mar: 3, abr: 4, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

const monthNamed = (w: string) => (Object.hasOwn(PARSE_MONTHS, w.toLowerCase()) ? PARSE_MONTHS[w.toLowerCase()] : undefined);

// ---------- importes y fechas en formato español (backend/app/parsers/base.py) ----------
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/€/g, "").replace(/EUR/g, "").replace(/ /g, "").replace(/^\*+/, "");
  if (/^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+\.\d{2}$/.test(s)) return Number(s);
  return null;
}

function validDate(y: number, m: number | undefined, d: number): string | null {
  if (!m || m < 1 || m > 12 || d < 1 || y < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    let y = Number(m[3]);
    y += y < 100 ? 2000 : 0;
    return validDate(y, Number(m[2]), Number(m[1]));
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = s.match(/^(\d{1,2})(?: de)? ([A-Za-zé]+)(?: de)? (\d{4})$/))) return validDate(Number(m[3]), monthNamed(m[2]), Number(m[1]));
  if ((m = s.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/))) return validDate(Number(m[3]), monthNamed(m[1]), Number(m[2]));
  return null;
}

// ---------- tipos ----------
export function incomeMonthDate(day: string, detail: string): string {
  const d = new Date(`${day.slice(0, 8)}01T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 32);
  const next = `${d.toISOString().slice(0, 8)}01`;
  const named = new Set((fold(detail).match(/[a-z]+/g) ?? []).filter((w) => Object.hasOwn(MONTH_NUM, w)).map((w) => MONTH_NUM[w]));
  return Number(day.slice(8, 10)) >= 20 && named.size === 1 && named.has(Number(next.slice(5, 7))) ? next : day;
}

export function incomeKind(concept: string, detail: string): string {
  const c = fold(concept), d = fold(detail);
  if (c.includes("efectivo")) return INC_CASH;
  if (c.includes("bizum") || d.includes("bizum")) return INC_BIZUM;
  if (c.startsWith("traspaso") || c.startsWith("transferencia")) {
    return (d.match(/[a-z]+/g) ?? []).some((w) => MONTH_WORDS.has(w)) ? INC_MONTHLY : INC_TRANSFER;
  }
  return INC_REFUND;
}

export function kindOf(concept: string, detail: string, amount: number): string {
  const c = fold(concept), d = fold(detail);
  if (c.startsWith("traspaso")) return INTERNAL;
  if (c.startsWith("transferencia")) return TRANSFER;
  if (amount > 0) return INCOME;
  if (c.includes("bizum")) return BIZUM;
  if (c.startsWith("ret. efectivo") || c.includes("cajero")) return CASH;
  if (c.startsWith("adeudo") || d.startsWith("adeudo") || c.includes("recibo")) return DEBIT;
  if (d.includes("tarjeta") || c.includes("tarjeta")) return CARD;
  return OTHER;
}

export function suggestCategory(...texts: string[]): string | null {
  const t = " " + fold(texts.join(" ")).replaceAll(",", " ").replace(/\s+/g, " ") + " ";
  for (const [category, words] of CATEGORY_RULES) if (words.some((w) => t.includes(w))) return category;
  return null;
}

// ---------- lectura del Excel ----------
export interface Movement {
  key: string; date: string; amount: number; concept: string; detail: string; notes: string; kind: string;
  category: string | null; group: string; status: "nuevo" | "importado" | "duplicado";
  duplicate_of: Described | null; mismatch: Described | null; fills_gap: FillsGap | null; income_kind: string | null;
}
export interface Described { id: number; date: string; description: string; amount: number; category: string | null; has_pdf: boolean }
interface FillsGap { category: string; month: string; period_from: string | null; period_to: string | null }

const clean = (v: Cell | undefined) => {
  if (v === null || v === undefined || v === "" || v === false) return "";
  if (v instanceof XNum && v.value === 0) return "";
  return pyStr(v).replace(/\s+/g, " ").trim();
};
const toDate = (v: Cell | undefined) => (v instanceof ExcelDate ? v.iso : v ? parseDate(clean(v)) : null);
const toAmount = (v: Cell | undefined) => (v instanceof XNum ? v.value : v ? parseAmount(clean(v)) : null);

type Cols = Record<"date" | "concept" | "amount" | "detail" | "notes" | "balance", number[]>;

function headerColumns(row: Cell[]): Cols | null {
  const names = row.map((c) => fold(clean(c)));
  if (!names.includes("concepto") || !names.includes("importe")) return null;
  const cols: Cols = { date: [], concept: [], amount: [], detail: [], notes: [], balance: [] };
  names.forEach((n, i) => {
    if (n.startsWith("fecha") || n.startsWith("f.valor") || n.startsWith("f. valor")) cols.date.push(i);
    else if (n === "concepto") cols.concept.push(i);
    else if (n === "importe") cols.amount.push(i);
    else if (["movimiento", "tipo de movimiento", "descripcion"].includes(n)) cols.detail.push(i);
    else if (n.startsWith("observaciones") || n.startsWith("mas datos")) cols.notes.push(i);
    else if (n === "disponible" || n === "saldo") cols.balance.push(i);
  });
  return cols.date.length ? cols : null;
}

/** Fecha como la escribe Python dentro de una lista: datetime.date(2026, 9, 16) */
const pyDateRepr = (iso: string) => `datetime.date(${Number(iso.slice(0, 4))}, ${Number(iso.slice(5, 7))}, ${Number(iso.slice(8, 10))})`;

async function sha256Hex(text: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

const CARD_NUMBER = /\b\d{15,16}\b/g;

export async function parseWorkbook(raw: Uint8Array, filename = ""): Promise<Movement[]> {
  let sheets;
  try {
    sheets = readXlsx(raw);
  } catch (err) {
    if (err instanceof XlsxError) throw new BankFileError(`${filename || "El archivo"} no es un Excel válido (.xlsx)`);
    throw err;
  }
  const out: Movement[] = [];
  const seen = new Map<string, number>();
  for (const ws of sheets) {
    let cols: Cols | null = null;
    for (const row of ws.rows) {
      if (cols === null) { cols = headerColumns(row); continue; }
      const c = cols;
      const get = (name: keyof Cols) => c[name].filter((i) => i < row.length).map((i) => row[i] ?? null);
      const concept = clean(get("concept")[0] ?? "");
      const amount = get("amount").map(toAmount).find((a) => a !== null) ?? null;
      let dates = get("date").map(toDate).filter((d): d is string => Boolean(d));
      if (!concept || amount === null || !dates.length) continue;
      const detail = clean(get("detail")[0] ?? "");
      let notes = clean(get("notes")[0] ?? "").replace(CARD_NUMBER, "").trim();
      const balanceCells = get("balance");
      const balance = balanceCells.length ? pyStr(balanceCells[0]) : "";
      const sorted = [...dates].sort();
      const base = [`[${sorted.map(pyDateRepr).join(", ")}]`, concept, detail, pyFloatStr(pyRound(amount, 2)), balance].join("|");
      seen.set(base, (seen.get(base) ?? 0) + 1);
      const key = (await sha256Hex(`${base}|${seen.get(base)}`)).slice(0, 32);
      const kind = kindOf(concept, detail, amount);
      const incKind = amount > 0 ? incomeKind(concept, detail) : null;
      const first = sorted[0];
      if (incKind === INC_MONTHLY && incomeMonthDate(first, detail) !== first) {
        notes = `Recibida el ${first.slice(8, 10)}/${first.slice(5, 7)}/${first.slice(0, 4)}` + (notes ? ` · ${notes}` : "");
        dates = [incomeMonthDate(first, detail)];
      }
      const namedBy = [INTERNAL, TRANSFER, BIZUM].includes(kind) && detail ? detail : concept;
      out.push({
        key, date: [...dates].sort()[0], amount: pyRound(amount, 2), concept, detail, notes, kind,
        group: merchantKey(namedBy), income_kind: incKind,
        category: amount < 0 ? suggestCategory(namedBy, notes) : null,
        status: "nuevo", duplicate_of: null, mismatch: null, fills_gap: null,
      });
    }
  }
  if (!out.length) {
    throw new BankFileError(`No se han encontrado movimientos en ${filename || "el archivo"} ` +
      "(se necesita una fila de títulos con «Concepto» e «Importe»)");
  }
  return out;
}

/** str() de un float de Python (round() devuelve float: -100 se escribe "-100.0"). */
function pyFloatStr(n: number) {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

// ---------- cotejo con lo registrado ----------
export interface BExpense {
  id: number; seq: number; date: string; amount_cents: number; description: string; provider: string | null;
  category: string | null; document_id: number | null; external_id: string | null; period_start: string | null; period_end: string | null;
}

const DUPLICATE_WINDOW = 7, MISMATCH_WINDOW = 10, GAP_BEFORE = 5, GAP_AFTER = 150;

export function reconcile(movements: Movement[], spans: [string, string][], expenses: BExpense[], importedKeys: Set<string>, today = todayIso()): Described[] {
  for (const m of movements) if (importedKeys.has(m.key)) m.status = "importado";
  const pending = movements.filter((m) => m.amount < 0 && m.status !== "importado");
  if (!pending.length) return [];
  const lo = addDays(pending.map((m) => m.date).reduce((a, b) => (b < a ? b : a)), -GAP_AFTER);
  const hi = addDays(pending.map((m) => m.date).reduce((a, b) => (b > a ? b : a)), GAP_AFTER);
  const candidates = expenses.filter((e) => e.date >= lo && e.date <= hi && !e.external_id).sort((a, b) => a.seq - b.seq || a.id - b.id);
  const used = new Set<number>();
  const describe = (e: BExpense): Described => ({ id: e.id, date: e.date, description: e.description, amount: e.amount_cents / 100,
    category: e.category, has_pdf: e.document_id != null });
  const dist = (e: BExpense, m: Movement) => Math.abs(dayNum(e.date) - dayNum(m.date));
  const closest = (m: Movement, ok: (e: BExpense) => boolean, window: number) => {
    let best: BExpense | null = null;
    for (const e of candidates) {
      if (!used.has(e.id) && dist(e, m) <= window && ok(e) && (!best || dist(e, m) < dist(best, m))) best = e;
    }
    return best;
  };
  const sameThing = (m: Movement, e: BExpense) => (m.category ? e.category != null && fold(e.category) === fold(m.category) : expenseMerchant(e) === m.group);

  for (const m of pending) {
    const cents = pyRound(-m.amount * 100);
    const match = closest(m, (e) => e.amount_cents === cents && sameThing(m, e), DUPLICATE_WINDOW);
    if (match) {
      used.add(match.id);
      m.status = "duplicado";
      m.duplicate_of = describe(match);
      m.category = match.category ?? m.category;
    }
  }
  for (const m of pending) {
    if (m.status === "nuevo" && m.kind === DEBIT && m.category) {
      const match = closest(m, (e) => e.amount_cents > 0 && e.category != null && fold(e.category) === fold(m.category!), MISMATCH_WINDOW);
      if (match) { used.add(match.id); m.mismatch = describe(match); }
    }
  }
  const gaps = missingInvoices([...expenses].sort((a, b) => a.seq - b.seq || a.id - b.id)
    .map((e) => ({ category: e.category ?? "", day: e.date, period_start: e.period_start, period_end: e.period_end })), today);
  const fits = (g: (typeof gaps)[number], m: Movement) => {
    if (fold(g.category) !== fold(m.category!)) return false;
    if (g.period_from) return dayNum(g.period_to!) - GAP_BEFORE <= dayNum(m.date) && dayNum(m.date) <= dayNum(g.period_to!) + GAP_AFTER;
    return Math.abs(monthIdx(m.date) - monthIdx(`${g.month}-01`)) <= 1;
  };
  for (const m of [...pending].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (m.status !== "nuevo" || m.mismatch || m.kind !== DEBIT || !m.category) continue;
    const i = gaps.findIndex((g) => fits(g, m));
    if (i >= 0) {
      const g = gaps.splice(i, 1)[0];
      m.fills_gap = { category: g.category, month: g.month, period_from: g.period_from, period_to: g.period_to };
    }
  }
  const debitCats = new Set(movements.filter((m) => m.kind === DEBIT && m.category).map((m) => fold(m.category!)));
  return [...candidates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter((e) => !used.has(e.id) && e.amount_cents > 0 && e.category && debitCats.has(fold(e.category))
      && spans.some(([a, b]) => a <= e.date && e.date <= b))
    .map(describe);
}
