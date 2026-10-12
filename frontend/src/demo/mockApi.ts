// API simulada en memoria para la demo (artefacto). Sustituye a fetch en las rutas /api/*.
// Los datos son de ejemplo y los PDF no se analizan de verdad.
import type { Category, DocumentResult, Expense } from "../api";
import { setDocumentUrlResolver } from "../api";
import { SAMPLE_PDF_BASE64 } from "./samplePdf";

let rng = 7;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const categories: Category[] = [
  ["Luz", "#6fa3e0"], ["Gas", "#f39a73"], ["Agua", "#7cc4d4"], ["Internet", "#e07f7f"],
  ["Calefacción", "#f2cc6b"], ["Comunidad", "#6cc39b"], ["Seguros", "#a596e6"], ["Supermercado", "#9bc47a"],
  ["Transporte", "#e98fb6"], ["Viajes", "#cdb595"], ["Ocio", "#c9a7d6"], ["Suscripciones", "#a9c2c9"],
  ["Otros", "#bdbab3"],
].map(([name, color], i) => ({ id: i + 1, name, color }));

const expenses: Expense[] = [];
let nextId = 1;
let loggedIn = true;

const catId = (name: string) => categories.find((c) => c.name === name)!.id;

function add(e: Partial<Expense> & Pick<Expense, "date" | "amount" | "description">) {
  expenses.push({
    id: nextId++, provider: null, invoice_number: null, period_start: null, period_end: null,
    category_id: null, category: null, source: "pdf",
    reviewed: true, notes: null, document_id: null, tags: [], concept: e.provider ?? e.description ?? "", ...e,
  });
}

for (const y of [2024, 2025, 2026]) {
  const lastMonth = y === 2026 ? 9 : 12;
  for (let m = 1; m <= lastMonth; m++) {
    const winter = [1, 2, 3, 12].includes(m);
    const gap = y === 2026 && (m === 6 || m === 7); // facturas "perdidas" de ejemplo
    if (!gap) add({ date: iso(y, m, 5), amount: between(winter ? 42 : 30, winter ? 68 : 48), description: `Luz ${String(m).padStart(2, "0")}/${y}`,
      provider: "Octopus Energy", category_id: catId("Luz"),
      period_start: iso(y, m === 1 ? 1 : m - 1, 6), period_end: iso(y, m, 5) });
    add({ date: iso(y, m, 28), amount: between(29.9, y === 2026 ? 33.5 : 31.5), description: `Internet ${String(m).padStart(2, "0")}/${y}`,
      provider: "DIGI", category_id: catId("Internet") });
    if (y === 2024 && m <= 4) {
      add({ date: iso(y, m, 8), amount: between(52, 58), description: `Calefacción ${String(m).padStart(2, "0")}/${y}`,
        provider: "Comunidad de propietarios", category_id: catId("Calefacción") });
    }
    if (m % 2 === 0 && !(y === 2026 && m === 6)) {
      add({ date: iso(y, m, 18), amount: between(winter ? 38 : 24, winter ? 55 : 31), description: `Gas ${String(m - 1).padStart(2, "0")}-${String(m).padStart(2, "0")}/${y}`,
        provider: "AS Energía", category_id: catId("Gas") });
    }
  }
  add({ date: iso(y, 3, 15), amount: between(180, 220), description: `Seguro hogar ${y}`, provider: "Aseguradora",
    category_id: catId("Seguros"), source: "manual" });
}
// Gastos sueltos de 2026 (irregulares: no generan avisos de facturas que faltan)
for (const [d, amount] of [["2026-09-17", 23.24], ["2026-09-30", 14.19], ["2026-10-05", 39.88], ["2026-10-08", 14.35]] as const) {
  add({ date: d, amount, description: "Compra supermercado", provider: "Supermercado", category_id: catId("Supermercado") });
}
for (const [d, amount] of [["2026-07-30", 3.12], ["2026-08-04", 2.1], ["2026-09-18", 26]] as const) {
  add({ date: d, amount, description: "Trayecto", provider: "Transporte urbano", category_id: catId("Transporte") });
}

// Importaciones recientes pendientes de revisar; la luz de septiembre trae su PDF de ejemplo
const samplePdfUrl = URL.createObjectURL(
  new Blob([Uint8Array.from(atob(SAMPLE_PDF_BASE64), (c) => c.charCodeAt(0))], { type: "application/pdf" }),
);
const documents: (DocumentResult & { url?: string })[] = [];
expenses.filter((e) => e.date >= "2026-09-01" && ["Luz", "Internet"].includes(categories.find((c) => c.id === e.category_id)!.name))
  .forEach((e) => {
    e.reviewed = false;
    e.notes = "Confianza: alta";
    if (e.description.startsWith("Luz")) {
      Object.assign(e, { amount: 40.26, invoice_number: "DEMO-2026-0917", period_start: "2026-08-10", period_end: "2026-09-09", document_id: 1 });
      documents.push({ id: 1, original_name: "LUZ_09_2026.pdf", status: "procesado", error: null, expense_id: e.id, duplicate: false, url: samplePdfUrl });
    }
  });

function hydrate(e: Expense): Expense {
  return {
    ...e,
    category: categories.find((c) => c.id === e.category_id)?.name ?? null,
  };
}

function aggregate(list: Expense[], key: (e: Expense) => number) {
  const out = new Map<number, { total: number; by_category: Record<string, number> }>();
  for (const e of list.map(hydrate)) {
    const k = key(e);
    const r = out.get(k) ?? { total: 0, by_category: {} };
    const cat = e.category ?? "Sin categoría";
    r.by_category[cat] = Math.round(((r.by_category[cat] ?? 0) + e.amount) * 100) / 100;
    r.total = Math.round((r.total + e.amount) * 100) / 100;
    out.set(k, r);
  }
  return out;
}

// Port de backend/app/missing.py: series mensuales o bimestrales con meses sin factura
function missingInvoices(list: Expense[]) {
  const series = new Map<string, Map<number, number>>();
  for (const e of list) {
    const key = e.category ?? "Sin categoría";
    const idx = Number(e.date.slice(0, 4)) * 12 + Number(e.date.slice(5, 7)) - 1;
    const counts = series.get(key) ?? new Map<number, number>();
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
    series.set(key, counts);
  }
  const today = new Date();
  const now = today.getFullYear() * 12 + today.getMonth();
  const out: { month: string; category: string; cadence: number }[] = [];
  for (const [category, counts] of series) {
    const months = [...counts.keys()].sort((a, b) => a - b);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (months.length < 3 || total / months.length > 1.5) continue;
    const gaps = months.slice(1).map((m, i) => m - months[i]).sort((a, b) => a - b);
    const c = gaps[Math.floor((gaps.length - 1) / 2)];
    if ((c !== 1 && c !== 2) || gaps.filter((g) => g === c).length / gaps.length < 0.5) continue;
    const start = months[0], last = months.at(-1)!;
    const end = now - last <= 3 * c ? Math.max(last, now - 1) : last;
    const expected = new Set<number>();
    for (let m = start; m <= end; m += c) expected.add(m);
    const available = new Map(counts);
    for (const m of [...expected].sort((a, b) => a - b)) {
      const cand = [m, m - 1, m + 1].find((k) => (available.get(k) ?? 0) > (k > m && expected.has(k) ? 1 : 0));
      if (cand === undefined) {
        out.push({ month: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`, category, cadence: c });
      } else available.set(cand, available.get(cand)! - 1);
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
}

const year = (e: Expense) => Number(e.date.slice(0, 4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function guessCategory(name: string) {
  const n = name.toLowerCase();
  if (n.includes("gas")) return "Gas";
  if (n.includes("int") || n.includes("fibra")) return "Internet";
  if (n.includes("agua")) return "Agua";
  if (n.includes("cale") || n.includes("comun")) return "Calefacción";
  return "Luz";
}

async function handle(method: string, url: URL, body: unknown): Promise<[number, unknown]> {
  const path = url.pathname;
  const q = url.searchParams;
  const parts = path.split("/").filter(Boolean); // ["api", recurso, id?, accion?]
  const id = Number(parts[2]);

  if (path === "/api/auth/me") return loggedIn ? [200, { username: "demo" }] : [401, { detail: "No autenticado" }];
  if (path === "/api/auth/login") { loggedIn = true; return [200, { username: "demo" }]; }
  if (path === "/api/auth/logout") { loggedIn = false; return [204, null]; }
  if (!loggedIn) return [401, { detail: "No autenticado" }];

  const crud = <T extends { id: number; name: string }>(list: T[]): [number, unknown] => {
    if (method === "GET") return [200, [...list].sort((a, b) => a.name.localeCompare(b.name, "es"))];
    if (method === "POST") {
      const b = body as Omit<T, "id">;
      if (list.some((x) => x.name.toLowerCase() === b.name.toLowerCase())) return [409, { detail: "Ya existe un elemento con ese nombre" }];
      const item = { ...b, id: Math.max(0, ...list.map((x) => x.id)) + 1 } as T;
      list.push(item);
      return [201, item];
    }
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return [404, { detail: "No encontrado" }];
    if (method === "PUT") { list[i] = { ...(body as T), id }; return [200, list[i]]; }
    if (method === "DELETE") { list.splice(i, 1); return [204, null]; }
    return [405, { detail: "Método no permitido" }];
  };

  if (parts[1] === "tags" && method === "GET") return [200, []];
  if (parts[1] === "prefs") return [200, method === "GET" ? {} : body];
  if (parts[1] === "activity") return [200, []];
  if (parts[1] === "review") return [200, method === "GET" ? { total: 0, dismissed: 0, sections: [] } : { dismissed: 0 }];
  if (parts[1] === "expenses" && parts[3] === "similar") return [200, { merchant: "", count: 0 }];
  if (parts[1] === "categories") {
    const res = crud(categories);
    if (method === "DELETE") expenses.forEach((e) => { if (e.category_id === id) e.category_id = null; });
    return res;
  }

  if (parts[1] === "expenses") {
    if (method === "GET" && !parts[2]) {
      let list = expenses.map(hydrate);
      if (q.get("year")) list = list.filter((e) => year(e) === Number(q.get("year")));
      if (q.get("category_id")) list = list.filter((e) => e.category_id === Number(q.get("category_id")));
      if (q.get("reviewed")) list = list.filter((e) => String(e.reviewed) === q.get("reviewed"));
      return [200, list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)];
    }
    if (method === "POST") {
      add({ ...(body as Expense), source: "manual" });
      return [201, hydrate(expenses.at(-1)!)];
    }
    const i = expenses.findIndex((e) => e.id === id);
    if (i < 0) return [404, { detail: "Gasto no encontrado" }];
    if (method === "GET") return [200, hydrate(expenses[i])];
    if (method === "PUT") { expenses[i] = { ...expenses[i], ...(body as Expense), id }; return [200, hydrate(expenses[i])]; }
    if (method === "PATCH") { expenses[i] = { ...expenses[i], ...(body as { reviewed: boolean }) }; return [200, hydrate(expenses[i])]; }
    if (method === "DELETE") { expenses.splice(i, 1); return [204, null]; }
  }

  if (parts[1] === "documents") {
    if (method === "GET") {
      return [200, documents.filter((d) => !q.get("status") || d.status === q.get("status")).map(({ url: _u, ...d }) => d)];
    }
    if (method === "POST" && !parts[2]) {
      const file = (body as FormData).get("file") as File;
      await sleep(1200 + rand() * 800); // simula el análisis del PDF
      const doc = { id: Math.max(0, ...documents.map((d) => d.id)) + 1, original_name: file.name, status: "procesado" as const, error: null,
        expense_id: nextId, duplicate: false, url: URL.createObjectURL(file) };
      documents.push(doc);
      const cat = guessCategory(file.name);
      const today = new Date().toISOString().slice(0, 10);
      add({ date: today, amount: between(25, 70), description: `${cat} (PDF de ejemplo)`, category_id: catId(cat),
        reviewed: false, document_id: doc.id, notes: "Demo: importe inventado, este PDF no se ha analizado" });
      return [201, doc];
    }
    if (method === "DELETE") {
      const i = documents.findIndex((d) => d.id === id);
      if (i >= 0) documents.splice(i, 1);
      return [204, null];
    }
  }

  if (parts[1] === "backup" && parts[2] === "import") {
    await sleep(800);
    return [200, { categorias: 0, documentos: 0, gastos: 0, gastos_omitidos: expenses.length }];
  }

  if (parts[1] === "stats") {
    const scoped = expenses;
    if (parts[2] === "years") {
      return [200, [...aggregate(scoped, year)].sort((a, b) => a[0] - b[0]).map(([y, r]) => ({ year: y, ...r }))];
    }
    if (parts[2] === "months") {
      const agg = aggregate(scoped.filter((e) => year(e) === Number(q.get("year"))), (e) => Number(e.date.slice(5, 7)));
      return [200, Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(agg.get(i + 1) ?? { total: 0, by_category: {} }) }))];
    }
    if (parts[2] === "missing") {
      const y = q.get("year");
      return [200, missingInvoices(scoped.map(hydrate)).filter((m) => !y || m.month.startsWith(`${y}-`))];
    }
    if (parts[2] === "coverage") {
      const y = q.get("year");
      const items = scoped.map(hydrate)
        .filter((e) => e.period_start && e.period_end && e.period_start <= `${y}-12-31` && e.period_end >= `${y}-01-01`)
        .map((e) => ({
          id: e.id, category: e.category ?? "Sin categoría", provider: e.provider, description: e.description,
          color: categories.find((c) => c.id === e.category_id)?.color ?? null, amount: e.amount, date: e.date,
          period_start: e.period_start, period_end: e.period_end, document_id: e.document_id,
        }));
      return [200, { items, gaps: [] }];
    }
    if (parts[2] === "summary") {
      const years = [...new Set(expenses.map(year))].sort();
      return [200, { pending_review: expenses.filter((e) => !e.reviewed).length, years }];
    }
  }
  return [404, { detail: "No encontrado" }];
}

export function installMockApi() {
  setDocumentUrlResolver((id) => documents.find((d) => d.id === id)?.url ?? "#");
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    // Se mira la ruta tal cual (no resuelta contra location: en file:// incluiría la unidad)
    if (typeof input !== "string" || !input.startsWith("/api/")) return realFetch(input, init);
    const url = new URL(input, "http://demo.local");
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    await sleep(60);
    const [status, data] = await handle(init?.method ?? "GET", url, body);
    return new Response(status === 204 ? null : JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json" },
    });
  };
}
