/** Revisión: lo que conviene mirar a mano (igual que backend/app/review.py, mismas claves para descartar). */
import { carKinds, expenseMerchant } from "./merchants";
import { missingInvoices, cmp } from "./missing";
import { daysBetween, dm, dmy, groupBy, median, money, today as todayIso } from "./py";
import { GENERIC_MERCHANTS, PERIODIC, SAVINGS_FROM_YEAR, SIN_CATEGORIA } from "./rules";
import type { DocumentRow, IncomeRow } from "./db";

export const DISMISSED_KEY = "review_dismissed";

/** Gasto con su categoría y etiquetas ya resueltas. */
export interface RExpense {
  id: number; date: string; amount_cents: number; description: string; provider: string | null; source: string;
  reviewed: boolean; notes: string | null; period_start: string | null; period_end: string | null;
  category: string | null; category_id: number | null; tagNames: string[];
}

interface Item {
  key: string; title: string; detail: string; amount: number | null; date: string | null;
  expense_ids: number[]; link: string | null;
}
interface Section { id: string; title: string; help: string; level: "alta" | "media" | "baja"; dismissable: boolean; items: Item[] }

const item = (key: string, title: string, o: Partial<Item> = {}): Item =>
  ({ key, title, detail: "", amount: null, date: null, expense_ids: [], link: null, ...o });
const section = (id: string, title: string, help: string, level: Section["level"], dismissable = true): Section =>
  ({ id, title, help, level, dismissable, items: [] });

const cat = (e: RExpense) => e.category ?? SIN_CATEGORIA;
const label = (e: RExpense) => `${dmy(e.date)} · ${e.description || e.provider || "—"}`;
/** sort(key=…, reverse=True) estable de Python */
const byDesc = <T>(key: (x: T) => string | number) => (a: T, b: T) => {
  const ka = key(a), kb = key(b);
  return ka < kb ? 1 : ka > kb ? -1 : 0;
};

function pending(expenses: RExpense[]) {
  const sec = section("pendientes", "Marcados para revisar",
    "PDF recién importados y gastos marcados con ⚑. Se resuelven abriéndolos y pulsando Confirmar.", "alta", false);
  for (const e of expenses.filter((e) => !e.reviewed).sort(byDesc((e) => e.date))) {
    sec.items.push(item(`pend:${e.id}`, label(e), { detail: cat(e) + (e.notes ? ` · ${e.notes}` : ""),
      amount: e.amount_cents / 100, date: e.date, expense_ids: [e.id] }));
  }
  return sec;
}

function duplicates(expenses: RExpense[]) {
  const sec = section("duplicados", "Posibles duplicados",
    "Mismo importe en fechas muy cercanas: un gasto PDF o manual y otro del mismo comercio en 3 días, " +
    "dos cargos del banco de 50 € o más el mismo día, o una factura y su recibo del banco en 10 días.", "alta");
  const seen = new Set<string>();
  for (const group of groupBy(expenses.filter((e) => e.amount_cents > 0), (e) => e.amount_cents).values()) {
    group.sort((a, b) => cmp(a.date, b.date));
    group.forEach((a, i) => {
      for (const b of group.slice(i + 1)) {
        const days = daysBetween(a.date, b.date);
        if (days > 10) break;
        const bothBank = a.source === "banco" && b.source === "banco";
        const sameMerchant = expenseMerchant(a) === expenseMerchant(b) && (bothBank ? days === 0 && a.amount_cents >= 5000 : days <= 3);
        const billAndReceipt = cat(a) === cat(b) && PERIODIC.has(cat(a)) && (a.source === "banco" || b.source === "banco") && a.source !== b.source;
        const otherPeriod = a.period_start && b.period_start && a.period_start !== b.period_start;
        if ((sameMerchant || billAndReceipt) && !otherPeriod && !seen.has(`${a.id}-${b.id}`)) {
          seen.add(`${a.id}-${b.id}`);
          sec.items.push(item(`dup:${a.id}-${b.id}`, `${cat(a)} · ${a.description || a.provider}`, {
            detail: `${dmy(a.date)} (${a.source}) y ${dmy(b.date)} (${b.source}) · ${sameMerchant ? "mismo comercio" : "factura y recibo del banco"}`,
            amount: a.amount_cents / 100, date: b.date, expense_ids: [a.id, b.id] }));
        }
      }
    });
  }
  sec.items.sort(byDesc((i) => i.date!));
  return sec;
}

function overlaps(expenses: RExpense[]) {
  const sec = section("solapes", "Facturas que se solapan",
    "Dos facturas de la misma categoría cubren los mismos días (más de 5): puede ser una factura " +
    "repetida, una rectificativa o un cambio de compañía.", "media");
  const periodic = expenses.filter((e) => PERIODIC.has(cat(e)) && e.period_start && e.period_end && e.amount_cents > 0);
  for (const [c, items] of groupBy(periodic, cat)) {
    items.sort((a, b) => cmp(a.period_start!, b.period_start!));
    items.forEach((a, i) => {
      for (const b of items.slice(i + 1)) {
        if (b.period_start! > a.period_end!) break;
        const end = a.period_end! < b.period_end! ? a.period_end! : b.period_end!;
        const overlap = daysBetween(b.period_start!, end);
        if (overlap > 5) {
          sec.items.push(item(`overlap:${a.id}-${b.id}`, `${c} · ${overlap} días repetidos`, {
            detail: `${dmy(a.period_start!)}–${dmy(a.period_end!)} (${a.provider || a.description}, ${money(a.amount_cents)}) y ` +
              `${dmy(b.period_start!)}–${dmy(b.period_end!)} (${b.provider || b.description}, ${money(b.amount_cents)})`,
            amount: (a.amount_cents + b.amount_cents) / 100, date: b.period_start, expense_ids: [a.id, b.id] }));
        }
      }
    });
  }
  sec.items.sort(byDesc((i) => i.date!));
  return sec;
}

function missing(expenses: RExpense[], today: string) {
  const sec = section("faltan", "Facturas que faltan",
    "Huecos en los gastos periódicos, por categoría y año (los mismos que marca el timeline de Resumen).", "media");
  const found = missingInvoices(expenses.map((e) => ({ category: cat(e), day: e.date, period_start: e.period_start, period_end: e.period_end })), today);
  const groups = groupBy(found, (m) => `${m.category}\u0000${m.month.slice(0, 4)}`);
  const sorted = [...groups.entries()].map(([k, ms]) => ({ c: k.split("\u0000")[0], y: Number(k.split("\u0000")[1]), ms }))
    .sort((a, b) => b.y - a.y || cmp(a.c, b.c));
  for (const { c, y, ms } of sorted) {
    ms.sort((a, b) => cmp(a.month, b.month));
    const parts = ms.map((m) => (m.period_from && m.period_to ? `${dm(m.period_from)}–${dm(m.period_to)}` : m.month.slice(5)));
    const catId = expenses.find((e) => cat(e) === c)?.category_id ?? null;
    sec.items.push(item(`missing:${c}:${y}:${ms.map((m) => m.month.slice(5)).join(",")}`,
      `${c} ${y} · ${ms.length} ${ms.length === 1 ? "hueco" : "huecos"}`, {
        detail: (ms[0].period_from ? "Periodos sin factura: " : "Meses sin factura: ") + parts.join(", "),
        date: `${y}-01-01`, link: `/gastos?anio=${y}` + (catId ? `&categoria=${catId}` : "") }));
  }
  return sec;
}

function uncategorized(expenses: RExpense[]) {
  const sec = section("sincategoria", "Sin categoría", "Gastos que no cuentan en ninguna categoría de los gráficos.", "media");
  for (const e of expenses.filter((e) => !e.category).sort(byDesc((e) => e.date))) {
    sec.items.push(item(`uncat:${e.id}`, label(e), { detail: e.provider || "", amount: e.amount_cents / 100, date: e.date, expense_ids: [e.id] }));
  }
  return sec;
}

function bigOthers(expenses: RExpense[]) {
  const sec = section("otros", "Gastos grandes en «Otros»", "100 € o más en la categoría Otros: quizá tienen una categoría mejor.", "baja");
  for (const e of expenses.filter((e) => cat(e) === "Otros" && e.amount_cents >= 10000).sort(byDesc((e) => e.amount_cents))) {
    sec.items.push(item(`otros:${e.id}`, label(e), { detail: e.notes || "", amount: e.amount_cents / 100, date: e.date, expense_ids: [e.id] }));
  }
  return sec;
}

function outliers(expenses: RExpense[], today: string) {
  const sec = section("raros", "Importes raros",
    "Gastos a 0 € o en negativo, con fecha futura, o un gasto periódico que triplica lo habitual de su categoría.", "media");
  const byCat = groupBy(expenses.filter((e) => PERIODIC.has(cat(e)) && e.amount_cents > 0), cat);
  const med = new Map([...byCat].filter(([, v]) => v.length >= 6).map(([c, v]) => [c, median(v.map((e) => e.amount_cents))]));
  for (const e of expenses) {
    let why: string | null = null;
    const m = med.get(cat(e));
    if (e.amount_cents <= 0) why = "importe 0 o negativo";
    else if (e.date > today) why = "fecha futura";
    else if (m !== undefined && e.amount_cents > 3 * m && e.amount_cents - m > 5000) why = `lo habitual en ${cat(e)} es ${money(Math.trunc(m))}`;
    if (why) sec.items.push(item(`raro:${e.id}`, label(e), { detail: `${cat(e)} · ${why}`, amount: e.amount_cents / 100, date: e.date, expense_ids: [e.id] }));
  }
  sec.items.sort(byDesc((i) => i.date!));
  return sec;
}

function mixedMerchants(expenses: RExpense[]) {
  const sec = section("mezclados", "Mismo comercio en varias categorías",
    "Gastos del banco del mismo comercio repartidos en categorías distintas: puede que alguno esté mal (o que sea a propósito).", "baja");
  for (const [key, items] of groupBy(expenses.filter((e) => e.source === "banco"), expenseMerchant)) {
    const cats = groupBy(items, cat);
    if (cats.size < 2 || key.length < 3 || GENERIC_MERCHANTS.has(key)) continue;
    let main = "";
    for (const [c, es] of cats) if (!main || es.length > cats.get(main)!.length) main = c;
    const odd = [...cats].filter(([c]) => c !== main).flatMap(([, es]) => es);
    const detail = [...cats].sort((a, b) => b[1].length - a[1].length).map(([c, es]) => `${c}: ${es.length}`).join(" · ");
    sec.items.push(item(`mixed:${key}`, `«${key}»`, { detail, amount: odd.reduce((s, e) => s + e.amount_cents, 0) / 100,
      date: items.map((e) => e.date).reduce((a, b) => (b > a ? b : a)), expense_ids: items.map((e) => e.id) }));
  }
  sec.items.sort((a, b) => b.expense_ids.length - a.expense_ids.length);
  return sec;
}

function carWithoutKind(expenses: RExpense[]) {
  const sec = section("coche", "Coche sin tipo",
    "Gastos del coche que salen como «Otros»: arrastra su etiqueta de tipo (Gasolina, Peajes…) en Gastos.", "baja");
  const car = expenses.filter((e) => cat(e) === "Coche");
  const kinds = carKinds(car);
  for (const e of [...car].sort(byDesc((e) => e.date))) {
    if (kinds.get(e.id) === "Otros") sec.items.push(item(`car:${e.id}`, label(e), { amount: e.amount_cents / 100, date: e.date, expense_ids: [e.id] }));
  }
  return sec;
}

function incomesSection(all: IncomeRow[], today: string) {
  const sec = section("ingresos", "Ingresos dudosos",
    `Desde ${SAVINGS_FROM_YEAR}: transferencias o Bizum de 500 € o más que pueden ser reembolsos de ` +
    "algo que no cuenta como gasto (y entonces inflan el ahorro), y meses sin aportación mensual.", "media");
  const incomes = all.filter((i) => i.date >= `${SAVINGS_FROM_YEAR}-01-01`).sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq || a.id - b.id);
  for (const i of incomes) {
    if ((i.kind === "Transferencias y reembolsos" || i.kind === "Bizum recibidos") && i.amount_cents >= 50000) {
      sec.items.push(item(`income:${i.id}`, `${dmy(i.date)} · ${i.description}`, { detail: i.kind, amount: i.amount_cents / 100,
        date: i.date, link: `/ahorro?anio=${i.date.slice(0, 4)}` }));
    }
  }
  const months = new Set(incomes.filter((i) => i.kind === "Aportaciones mensuales").map((i) => i.date.slice(0, 7)));
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let y = SAVINGS_FROM_YEAR, m = 1; y < ty || (y === ty && m < tm); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1]) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (!months.has(ym)) {
      sec.items.push(item(`nocontrib:${ym}`, `${ym} sin aportación mensual`, {
        detail: "No hay ninguna aportación de ese mes: el ahorro del mes sale más bajo.", date: `${ym}-01`, link: `/ahorro?anio=${y}` }));
    }
  }
  sec.items.sort(byDesc((i) => i.date!));
  return sec;
}

function documentsSection(docs: DocumentRow[], withExpense: Set<number>) {
  const sec = section("documentos", "PDF sin gasto", "PDF guardados que dieron error al leerse o que no tienen gasto asociado.", "baja");
  for (const d of [...docs].sort(byDesc((d) => d.uploaded_at ?? ""))) {
    if (["no es un gasto", "Misma factura", "misma factura"].some((w) => (d.error || "").includes(w))) continue;
    if (d.status === "error" || !withExpense.has(d.id)) {
      sec.items.push(item(`doc:${d.id}`, d.original_name, { detail: d.error || `estado: ${d.status}, sin gasto`, link: `/api/documents/${d.id}/file` }));
    }
  }
  return sec;
}

export function buildReview(expenses: RExpense[], incomes: IncomeRow[], docs: DocumentRow[], hidden: Set<string>,
  includeDismissed = false, today = todayIso()) {
  const withExpense = new Set(expenses.map((e) => (e as RExpense & { document_id?: number | null }).document_id).filter((x): x is number => x != null));
  const sections = [
    pending(expenses), duplicates(expenses), overlaps(expenses), missing(expenses, today), incomesSection(incomes, today),
    outliers(expenses, today), uncategorized(expenses), bigOthers(expenses), carWithoutKind(expenses), mixedMerchants(expenses),
    documentsSection(docs, withExpense),
  ];
  let total = 0, nHidden = 0;
  const out = sections.map((s) => {
    const visible = s.items.filter((i) => includeDismissed || !(s.dismissable && hidden.has(i.key)));
    if (!includeDismissed) nHidden += s.items.length - visible.length;
    total += includeDismissed ? visible.filter((i) => !hidden.has(i.key)).length : visible.length;
    return { ...s, items: visible.map((i) => ({ ...i, dismissed: s.dismissable && hidden.has(i.key) })) };
  });
  void nHidden;
  return { total, dismissed: hidden.size, sections: out };
}
