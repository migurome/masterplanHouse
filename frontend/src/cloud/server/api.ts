/**
 * Servidor del navegador: responde a las mismas rutas /api/* que el servidor FastAPI, con los datos descifrados
 * en memoria (Db). Las pestañas de la web no cambian: piden lo mismo y reciben lo mismo.
 */
import { BankFileError, DEFAULT_EXCLUDED, DEFAULT_EXCLUDED_INCOME, INCOME_KINDS, INCOME_SETTING_KEY, LEARNED_KEY, Movement,
  parseWorkbook, reconcile, SETTING_KEY } from "./bank";
import type { CategoryRow, Db, DocumentRow, ExpenseRow, IncomeRow, Kind, LogRow, Row, TagRow } from "./db";
import { carKinds, concept, expenseMerchant, KIND_TAGS, KINDS, merchantKey } from "./merchants";
import { cmp, missingInvoices } from "./missing";
import { addDays, fold, month, pyRound, year } from "./py";
import { buildReview, DISMISSED_KEY, RExpense } from "./review";
import { SAVINGS_FROM_YEAR, SIN_CATEGORIA } from "./rules";

export const APP_VERSION = "0.22.0";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PdfResult {
  is_invoice: boolean; provider: string | null; category: string; total_amount: number | null; invoice_number: string | null;
  issue_date: string | null; charge_date: string | null; period_start: string | null; period_end: string | null;
  description: string; confidence: string; notes: string | null; parser: string;
}

export interface Ctx {
  user: string;
  today: () => string;
  now: () => string; // "AAAA-MM-DDTHH:MM:SS" en UTC, como guardaba el servidor
  files?: { put(uid: string, bytes: Uint8Array): Promise<void>; del(uid: string): Promise<void>; get(uid: string): Promise<Uint8Array> };
  readPdf?: (bytes: Uint8Array, name: string, categories: string[], hint: string | null) => Promise<PdfResult>;
  signOut?: () => void;
  exportBackup?: (includePdfs: boolean) => Promise<Blob>;
  importBackup?: (file: File, mode: string) => Promise<unknown>;
}

export interface Req { method: string; path: string; query: URLSearchParams; body: unknown }

const PALETTE = ["#6fa3e0", "#f39a73", "#7cc4d4", "#e07f7f", "#f2cc6b", "#6cc39b", "#a596e6", "#9bc47a", "#e98fb6"];
const NO_NUMBER = new Set(["", "na", "n/a", "n.a.", "-", "--", "s/n", "sn", "sin numero", "sin número", "ninguno", "none", "0"]);
export const cleanInvoiceNumber = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return NO_NUMBER.has(s.toLowerCase()) ? null : s;
};
const MANUAL_KINDS = ["Nóminas", ...INCOME_KINDS, "Otros ingresos"];
const MAX_DETAILS = 200;

// ---------- ayudas ----------
const byNewest = <T extends { date: string; seq: number; id: number }>(a: T, b: T) =>
  cmp(b.date, a.date) || b.seq - a.seq || b.id - a.id;
const byOldest = <T extends { seq: number; id: number }>(a: T, b: T) => a.seq - b.seq || a.id - b.id;
/** LIKE de SQLite: sin distinguir mayúsculas solo en letras ASCII */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const like = (text: string | null | undefined, word: string) => asciiLower(text ?? "").includes(asciiLower(word));

function bool(v: string | null): boolean | null {
  if (v === null || v === "") return null;
  if (["true", "1", "yes", "on"].includes(v.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(v.toLowerCase())) return false;
  throw new HttpError(422, `Valor no válido: ${v}`);
}
function int(v: string | null): number | null {
  if (v === null || v === "") return null;
  if (!/^-?\d+$/.test(v)) throw new HttpError(422, `Número no válido: ${v}`);
  return Number(v);
}
function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new HttpError(422, `Número no válido: ${v}`);
  return n;
}
function isoDate(v: unknown, field: string, required = false): string | null {
  if (v === null || v === undefined || v === "") {
    if (required) throw new HttpError(422, `Falta ${field}`);
    return null;
  }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(422, `Fecha no válida en ${field}`);
  return v;
}
const str = (v: unknown, def: string | null = null) => (v === null || v === undefined ? def : String(v));
const get = <T extends Row>(t: Map<number, T>, id: number, what = "No encontrado") => {
  const r = t.get(id);
  if (!r) throw new HttpError(404, what);
  return r;
};

export class Server {
  constructor(public db: Db, public ctx: Ctx) {}

  // ---------- vistas ----------
  private catName = (id: number | null) => (id == null ? null : this.db.categories.get(id)?.name ?? null);
  private tagNames = (e: ExpenseRow) => e.tag_ids.map((t) => this.db.tags.get(t)?.name).filter((n): n is string => Boolean(n));
  private expensesAsc = () => [...this.db.expenses.values()].sort((a, b) => cmp(a.date, b.date) || byOldest(a, b));
  private allExpenses = () => [...this.db.expenses.values()].sort(byOldest);

  expenseOut(e: ExpenseRow) {
    const tags = e.tag_ids.map((t) => this.db.tags.get(t)).filter((t): t is TagRow => Boolean(t))
      .sort((a, b) => cmp(a.name, b.name)).map((t) => ({ name: t.name, color: t.color, id: t.id }));
    return {
      id: e.id, date: e.date, amount: e.amount_cents / 100, description: e.description, provider: e.provider,
      invoice_number: e.invoice_number, period_start: e.period_start, period_end: e.period_end, category_id: e.category_id,
      category: this.catName(e.category_id), source: e.source, reviewed: e.reviewed, notes: e.notes, document_id: e.document_id,
      tags, concept: concept(e), similar_updated: 0,
    };
  }

  private rexp = (e: ExpenseRow): RExpense & { document_id: number | null } => ({
    ...e, category: this.catName(e.category_id), tagNames: this.tagNames(e),
  });

  // ---------- rutas ----------
  async handle(req: Req): Promise<[number, unknown]> {
    const { method: m, path } = req;
    const p = path.replace(/\/+$/, "");
    const id = (re: RegExp) => Number(p.match(re)![1]);
    const routes: [string, RegExp, () => unknown | Promise<unknown>, number?][] = [
      ["GET", /^\/api\/health$/, () => ({ ok: true, version: APP_VERSION })],
      ["GET", /^\/api\/auth\/me$/, () => ({ username: this.ctx.user })],
      ["POST", /^\/api\/auth\/logout$/, () => { this.ctx.signOut?.(); return null; }, 204],
      ["GET", /^\/api\/categories$/, () => [...this.db.categories.values()].sort((a, b) => cmp(a.name, b.name)).map(this.catOut)],
      ["POST", /^\/api\/categories$/, () => this.saveNamed("category", null, req.body), 201],
      ["PUT", /^\/api\/categories\/(\d+)$/, () => this.saveNamed("category", id(/(\d+)$/), req.body)],
      ["DELETE", /^\/api\/categories\/(\d+)$/, () => this.deleteCategory(id(/(\d+)$/)), 204],
      ["GET", /^\/api\/tags$/, () => this.listTags()],
      ["POST", /^\/api\/tags$/, () => this.saveNamed("tag", null, req.body), 201],
      ["PUT", /^\/api\/tags\/(\d+)$/, () => this.saveNamed("tag", id(/(\d+)$/), req.body)],
      ["DELETE", /^\/api\/tags\/(\d+)$/, () => this.deleteTag(id(/(\d+)$/)), 204],
      ["POST", /^\/api\/tags\/(\d+)\/apply$/, () => this.applyTag(id(/tags\/(\d+)/), req.body)],
      ["GET", /^\/api\/expenses$/, () => this.listExpenses(req.query)],
      ["POST", /^\/api\/expenses$/, () => this.createExpense(req.body), 201],
      ["GET", /^\/api\/expenses\/(\d+)$/, () => this.expenseOut(get(this.db.expenses, id(/(\d+)$/), "Gasto no encontrado"))],
      ["GET", /^\/api\/expenses\/(\d+)\/similar$/, () => {
        const e = get(this.db.expenses, id(/expenses\/(\d+)/), "Gasto no encontrado");
        return { merchant: expenseMerchant(e), count: this.similar(e).length };
      }],
      ["PUT", /^\/api\/expenses\/(\d+)$/, () => this.updateExpense(id(/(\d+)$/), req.body, bool(req.query.get("apply_similar")) ?? true)],
      ["PATCH", /^\/api\/expenses\/(\d+)\/review$/, () => {
        const e = get(this.db.expenses, id(/expenses\/(\d+)/), "Gasto no encontrado");
        const reviewed = (req.body as { reviewed?: unknown })?.reviewed;
        if (typeof reviewed !== "boolean") throw new HttpError(422, "Falta reviewed");
        this.db.save("expense", { ...e, reviewed });
        return this.expenseOut(this.db.expenses.get(e.id)!);
      }],
      ["DELETE", /^\/api\/expenses\/(\d+)$/, () => { this.db.remove("expense", get(this.db.expenses, id(/(\d+)$/), "Gasto no encontrado")); return null; }, 204],
      ["GET", /^\/api\/incomes\/kinds$/, () => MANUAL_KINDS],
      ["GET", /^\/api\/incomes$/, () => {
        const y = int(req.query.get("year"));
        return [...this.db.incomes.values()].filter((i) => y === null || year(i.date) === y).sort(byNewest).map(this.incomeOut);
      }],
      ["POST", /^\/api\/incomes$/, () => this.saveIncome(null, req.body), 201],
      ["PUT", /^\/api\/incomes\/(\d+)$/, () => this.saveIncome(id(/(\d+)$/), req.body)],
      ["DELETE", /^\/api\/incomes\/(\d+)$/, () => { this.db.remove("income", get(this.db.incomes, id(/(\d+)$/), "Ingreso no encontrado")); return null; }, 204],
      ["GET", /^\/api\/documents$/, () => this.listDocuments(req.query.get("status"))],
      ["POST", /^\/api\/documents$/, () => this.uploadDocument(req.body as FormData), 201],
      ["POST", /^\/api\/documents\/(\d+)\/reprocess$/, () => this.reprocess(id(/documents\/(\d+)/))],
      ["DELETE", /^\/api\/documents\/(\d+)$/, () => this.deleteDocument(id(/(\d+)$/)), 204],
      ["GET", /^\/api\/stats\/years$/, () => this.byYear()],
      ["GET", /^\/api\/stats\/months$/, () => this.byMonth(int(req.query.get("year")) ?? (() => { throw new HttpError(422, "Falta year"); })())],
      ["GET", /^\/api\/stats\/missing$/, () => {
        const y = req.query.get("year");
        return this.missing().filter((x) => !y || x.month.startsWith(`${y}-`));
      }],
      ["GET", /^\/api\/stats\/coverage$/, () => this.coverage(int(req.query.get("year"))!)],
      ["GET", /^\/api\/stats\/breakdown$/, () => this.breakdown()],
      ["GET", /^\/api\/stats\/car$/, () => this.car()],
      ["GET", /^\/api\/stats\/savings$/, () => this.savings()],
      ["GET", /^\/api\/stats\/summary$/, () => ({
        pending_review: [...this.db.expenses.values()].filter((e) => !e.reviewed).length,
        years: [...new Set([...this.db.expenses.values()].map((e) => year(e.date)))].sort((a, b) => a - b),
      })],
      ["GET", /^\/api\/review$/, () => this.review(bool(req.query.get("include_dismissed")) ?? false)],
      ["POST", /^\/api\/review\/dismiss$/, () => this.setDismissed((h) => new Set([...h, ...this.keys(req.body)]))],
      ["POST", /^\/api\/review\/restore$/, () => {
        const keys = this.keys(req.body);
        return this.setDismissed((h) => (keys.length ? new Set([...h].filter((k) => !keys.includes(k))) : new Set()));
      }],
      ["POST", /^\/api\/bank\/preview$/, () => this.bankPreview(req.body as FormData)],
      ["POST", /^\/api\/bank\/import$/, () => this.bankImport(req.body)],
      ["GET", /^\/api\/bank\/imports$/, () => this.bankImports()],
      ["POST", /^\/api\/bank\/imports\/undo$/, () => this.bankUndo(req.body)],
      ["GET", /^\/api\/activity$/, () => this.activity(req.query)],
      ["GET", /^\/api\/activity\/users$/, () => [...new Set([...this.db.logs.values()].map((l) => l.user))].sort(cmp)],
      ["GET", /^\/api\/prefs$/, () => this.db.setting<Record<string, unknown>>(`prefs:${this.ctx.user}`) ?? {}],
      ["PUT", /^\/api\/prefs$/, () => {
        const value = { ...(this.db.setting<Record<string, unknown>>(`prefs:${this.ctx.user}`) ?? {}), ...(req.body as object) };
        this.db.setSetting(`prefs:${this.ctx.user}`, value);
        return value;
      }],
      ["POST", /^\/api\/backup\/import$/, () => {
        if (!this.ctx.importBackup) throw new HttpError(501, "No disponible");
        return this.ctx.importBackup((req.body as FormData).get("file") as File, req.query.get("mode") ?? "merge");
      }],
    ];
    for (const [method, re, fn, status] of routes) {
      if (method === m && re.test(p)) return [status ?? 200, await fn()];
    }
    throw new HttpError(404, "No encontrado");
  }

  // ---------- categorías y etiquetas ----------
  private catOut = (c: CategoryRow) => ({ name: c.name, color: c.color, id: c.id });

  private saveNamed(kind: "category" | "tag", id: number | null, body: unknown) {
    const b = body as { name?: unknown; color?: unknown };
    let name = str(b?.name, "")!;
    if (kind === "tag") name = name.split(/\s+/).filter(Boolean).join(" ");
    if (!name || name.length > 50) throw new HttpError(422, kind === "tag" && !name ? "El nombre no puede estar vacío" : "Nombre no válido");
    const table = kind === "category" ? this.db.categories : this.db.tags;
    if ([...table.values()].some((x) => x.name === name && x.id !== id)) throw new HttpError(409, "Ya existe un elemento con ese nombre");
    const fields = { name, color: str(b?.color) };
    if (id === null) return this.catOut(this.db.create(kind, fields));
    const row = { ...get(table, id), ...fields };
    this.db.save(kind, row);
    return this.catOut(row);
  }

  private deleteCategory(id: number) {
    const c = get(this.db.categories, id);
    for (const e of this.db.expenses.values()) if (e.category_id === id) this.db.save("expense", { ...e, category_id: null });
    this.db.remove("category", c);
    return null;
  }

  private listTags() {
    const usage = new Map<number, [number, number]>();
    for (const e of this.db.expenses.values()) {
      for (const t of new Set(e.tag_ids)) {
        const [n, cents] = usage.get(t) ?? [0, 0];
        usage.set(t, [n + 1, cents + e.amount_cents]);
      }
    }
    return [...this.db.tags.values()].sort((a, b) => cmp(a.name, b.name)).map((t) => ({
      name: t.name, color: t.color, id: t.id, count: usage.get(t.id)?.[0] ?? 0, total: (usage.get(t.id)?.[1] ?? 0) / 100,
    }));
  }

  private deleteTag(id: number) {
    const t = get(this.db.tags, id);
    for (const e of this.db.expenses.values()) {
      if (e.tag_ids.includes(id)) this.db.save("expense", { ...e, tag_ids: e.tag_ids.filter((x) => x !== id) });
    }
    this.db.remove("tag", t);
    return null;
  }

  private applyTag(tagId: number, body: unknown) {
    const tag = get(this.db.tags, tagId);
    const b = body as { expense_ids?: number[]; remove?: boolean };
    const kindIds = new Set([...this.db.tags.values()].filter((t) => KIND_TAGS.includes(t.name)).map((t) => t.id));
    let changed = 0;
    for (const eid of new Set(b?.expense_ids ?? [])) {
      const e = this.db.expenses.get(eid);
      if (!e) continue;
      const has = e.tag_ids.includes(tagId);
      if (b.remove && has) {
        this.db.save("expense", { ...e, tag_ids: e.tag_ids.filter((x) => x !== tagId) });
        changed++;
      } else if (!b.remove && !has) {
        const keep = KIND_TAGS.includes(tag.name) ? e.tag_ids.filter((x) => !kindIds.has(x)) : e.tag_ids;
        this.db.save("expense", { ...e, tag_ids: [...keep, tagId] });
        changed++;
      }
    }
    return { changed };
  }

  // ---------- gastos ----------
  private listExpenses(q: URLSearchParams) {
    const y = int(q.get("year")), cat = int(q.get("category_id")), reviewed = bool(q.get("reviewed"));
    const from = q.get("date_from"), to = q.get("date_to"), tagId = int(q.get("tag_id"));
    const min = num(q.get("amount_min")), max = num(q.get("amount_max"));
    const ids = q.get("ids") ? new Set(q.get("ids")!.split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)) : null;
    const words = (q.get("q") ?? "").trim().split(/\s+/).filter(Boolean)
      .map((w) => ({ exclude: w.startsWith("!"), word: w.replace(/^!+/, "") })).filter((w) => w.word);
    let found = [...this.db.expenses.values()].filter((e) =>
      (y === null || year(e.date) === y)
      && (cat === null || (cat === 0 ? e.category_id === null || !this.db.categories.has(e.category_id) : e.category_id === cat))
      && (reviewed === null || e.reviewed === reviewed)
      && (!from || e.date >= from) && (!to || e.date <= to)
      && (!ids || ids.has(e.id))
      && (tagId === null || e.tag_ids.includes(tagId))
      && (min === null || e.amount_cents >= pyRound(min * 100))
      && (max === null || e.amount_cents <= pyRound(max * 100))
      && words.every(({ exclude, word }) => {
        const hit = this.tagNames(e).some((n) => like(n, word)) || [e.description, e.provider, e.notes].some((t) => like(t, word));
        return exclude ? !hit : hit;
      }));
    const kind = q.get("car_kind");
    if (kind) {
      const car = this.allExpenses().filter((e) => this.catName(e.category_id) === "Coche");
      const kinds = carKinds(car.map((e) => ({ ...e, tagNames: this.tagNames(e) })));
      found = found.filter((e) => kinds.get(e.id) === kind);
    }
    return found.sort(byNewest).map((e) => this.expenseOut(e));
  }

  private expenseFields(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const amount = Number(b.amount);
    if (b.amount === undefined || b.amount === null || Number.isNaN(amount)) throw new HttpError(422, "Importe no válido");
    const catId = b.category_id == null ? null : Number(b.category_id);
    if (catId !== null && !this.db.categories.has(catId)) throw new HttpError(422, "Categoría no válida");
    return {
      fields: {
        date: isoDate(b.date, "date", true)!, amount_cents: pyRound(amount * 100), description: str(b.description, "")!,
        provider: str(b.provider), invoice_number: cleanInvoiceNumber(str(b.invoice_number)),
        period_start: isoDate(b.period_start, "period_start"), period_end: isoDate(b.period_end, "period_end"),
        category_id: catId, notes: str(b.notes), reviewed: b.reviewed === undefined ? true : Boolean(b.reviewed),
      },
      tagIds: Array.isArray(b.tag_ids) ? (b.tag_ids as number[]).filter((t) => this.db.tags.has(t)) : null,
    };
  }

  private createExpense(body: unknown) {
    const { fields, tagIds } = this.expenseFields(body);
    const e = this.db.create("expense", { ...fields, source: "manual", external_id: null, import_batch: null,
      created_at: this.ctx.now(), document_id: null, tag_ids: tagIds ?? [] });
    return this.expenseOut(e);
  }

  /** Otros gastos del mismo comercio que tienen la misma categoría que este. */
  private similar(e: ExpenseRow) {
    const key = expenseMerchant(e);
    if (key.length < 3) return [];
    return this.allExpenses().filter((x) => x.id !== e.id && x.category_id === e.category_id && expenseMerchant(x) === key);
  }

  private updateExpense(id: number, body: unknown, applySimilar: boolean) {
    const e = get(this.db.expenses, id, "Gasto no encontrado");
    const { fields, tagIds } = this.expenseFields(body);
    const changed = fields.category_id !== e.category_id;
    const similar = changed && applySimilar ? this.similar(e) : [];
    const updated = { ...e, ...fields, tag_ids: tagIds ?? e.tag_ids };
    this.db.save("expense", updated);
    for (const s of similar) this.db.save("expense", { ...s, category_id: fields.category_id });
    const cat = this.catName(fields.category_id);
    if (changed && cat && e.source === "banco") this.learn({ [expenseMerchant(updated)]: cat });
    return { ...this.expenseOut(updated), similar_updated: similar.length };
  }

  private learn(choices: Record<string, string>) {
    if (!Object.keys(choices).length) return;
    this.db.setSetting(LEARNED_KEY, { ...(this.db.setting<Record<string, string>>(LEARNED_KEY) ?? {}), ...choices });
  }

  // ---------- ingresos ----------
  private incomeOut = (i: IncomeRow) => ({ id: i.id, date: i.date, amount: i.amount_cents / 100, description: i.description,
    kind: i.kind, source: i.source, notes: i.notes });

  private saveIncome(id: number | null, body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const amount = Number(b.amount);
    if (!(amount > 0)) throw new HttpError(422, "El importe debe ser mayor que 0");
    const fields = { date: isoDate(b.date, "date", true)!, amount_cents: pyRound(amount * 100),
      description: str(b.description, "")!.slice(0, 255), kind: str(b.kind, "Otros ingresos")!.slice(0, 40), notes: str(b.notes) };
    if (id === null) {
      return this.incomeOut(this.db.create("income", { ...fields, source: "manual", external_id: null, import_batch: null, created_at: this.ctx.now() }));
    }
    const row = { ...get(this.db.incomes, id, "Ingreso no encontrado"), ...fields };
    this.db.save("income", row);
    return this.incomeOut(row);
  }

  // ---------- documentos ----------
  private docOut(d: DocumentRow, duplicate = false) {
    const exp = [...this.db.expenses.values()].find((e) => e.document_id === d.id);
    return { id: d.id, original_name: d.original_name, status: d.status, error: d.error, expense_id: exp?.id ?? null, duplicate };
  }

  private listDocuments(status: string | null) {
    return [...this.db.documents.values()].filter((d) => !status || d.status === status)
      .sort((a, b) => cmp(b.uploaded_at ?? "", a.uploaded_at ?? "") || byOldest(a, b)).map((d) => this.docOut(d));
  }

  private async uploadDocument(form: FormData) {
    const file = form?.get("file") as File | null;
    if (!file) throw new HttpError(422, "Falta el archivo");
    if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "El archivo supera 20 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "%PDF") throw new HttpError(415, "Solo se admiten archivos PDF");
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const existing = [...this.db.documents.values()].find((d) => d.sha256 === sha);
    if (existing) return this.docOut(existing, true);
    const doc = this.db.create("document", { original_name: file.name || "documento.pdf", sha256: sha, status: "pendiente",
      error: null, extracted: null, uploaded_at: this.ctx.now(), has_file: true });
    await this.ctx.files?.put(doc.uid, bytes);
    const result = await this.process(doc, bytes);
    if (result.status === "duplicado") { // misma factura con otro archivo: no se guarda
      this.db.remove("document", this.db.documents.get(doc.id)!);
      await this.ctx.files?.del(doc.uid);
      return { ...this.docOut(result), duplicate: true };
    }
    return this.docOut(result);
  }

  private async reprocess(id: number) {
    const d = get(this.db.documents, id, "Documento no encontrado");
    if ([...this.db.expenses.values()].some((e) => e.document_id === id)) {
      throw new HttpError(409, "El documento ya tiene un gasto asociado; bórralo antes de reprocesar");
    }
    if (!this.ctx.files) throw new HttpError(501, "No disponible");
    return this.docOut(await this.process(d, await this.ctx.files.get(d.uid)));
  }

  /** Lee el PDF y crea su gasto pendiente de revisar (como process_document de Python). */
  private async process(doc: DocumentRow, bytes: Uint8Array): Promise<DocumentRow> {
    const save = (changes: Partial<DocumentRow>) => {
      const row = { ...this.db.documents.get(doc.id)!, ...changes };
      this.db.save("document", row);
      return row;
    };
    if (!this.ctx.readPdf) return save({ status: "error", error: "Este navegador no puede leer PDF" });
    let info: PdfResult;
    try {
      info = await this.ctx.readPdf(bytes, doc.original_name, [...this.db.categories.values()].map((c) => c.name), null);
    } catch (err) {
      return save({ status: "error", error: String((err as Error).message ?? err) });
    }
    if (!info.is_invoice || info.total_amount === null) {
      return save({ extracted: info, status: info.is_invoice ? "error" : "descartado", error: info.notes || "No parece una factura o no tiene importe" });
    }
    const number = cleanInvoiceNumber(info.invoice_number);
    const same = number ? this.allExpenses().find((e) => (e.invoice_number ?? "").trim().toLowerCase() === number.toLowerCase()
      && (!info.provider || !e.provider || e.provider.toLowerCase() === info.provider.toLowerCase())) : undefined;
    if (same) {
      const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
      const what = [this.catName(same.category_id), `${(same.amount_cents / 100).toFixed(2).replace(".", ",")} €`,
        same.period_start && same.period_end ? `periodo ${fmt(same.period_start)} - ${fmt(same.period_end)}` : `del ${fmt(same.date)}`]
        .filter(Boolean).join(", ");
      return save({ extracted: info, status: "duplicado",
        error: `Misma factura (${info.invoice_number}) que el gasto #${same.id}: ${same.description} (${what})` });
    }
    const notes = [info.notes, `Leído con: ${info.parser}`, `Confianza: ${info.confidence}`].filter(Boolean).join(" · ");
    this.db.create("expense", {
      date: info.charge_date || info.issue_date || info.period_end || this.ctx.today(), amount_cents: pyRound(info.total_amount * 100),
      description: info.description, provider: info.provider, invoice_number: number, period_start: info.period_start,
      period_end: info.period_end, category_id: this.categoryFor(info.category).id, source: "pdf", reviewed: false, notes,
      external_id: null, import_batch: null, created_at: this.ctx.now(), document_id: doc.id, tag_ids: [],
    });
    return save({ extracted: info, status: "procesado", error: null });
  }

  private async deleteDocument(id: number) {
    const d = get(this.db.documents, id, "Documento no encontrado");
    for (const e of [...this.db.expenses.values()]) if (e.document_id === id) this.db.remove("expense", e);
    this.db.remove("document", d);
    await this.ctx.files?.del(d.uid);
    return null;
  }

  /** Categoría por nombre sin distinguir mayúsculas ni acentos; si no existe se crea con el primer color libre. */
  private categoryFor(name: string): CategoryRow {
    const n = name.trim() || "Otros";
    const found = [...this.db.categories.values()].sort(byOldest).find((c) => fold(c.name) === fold(n));
    if (found) return found;
    const used = new Set([...this.db.categories.values()].map((c) => c.color));
    return this.db.create("category", { name: n, color: PALETTE.find((c) => !used.has(c)) ?? null });
  }

  // ---------- estadísticas ----------
  private aggregate(list: ExpenseRow[], key: (e: ExpenseRow) => number) {
    const groups = new Map<number, Map<string | null, number>>();
    for (const e of list) {
      const k = key(e);
      const cats = groups.get(k) ?? new Map<string | null, number>();
      const c = this.catName(e.category_id);
      cats.set(c, (cats.get(c) ?? 0) + e.amount_cents);
      groups.set(k, cats);
    }
    const out = new Map<number, { total: number; by_category: Record<string, number> }>();
    for (const [k, cats] of groups) {
      const r = { total: 0, by_category: {} as Record<string, number> };
      // Mismo orden que SQLite al agrupar: sin categoría primero y luego por nombre
      for (const [c, cents] of [...cats].sort((a, b) => (a[0] === null ? -1 : b[0] === null ? 1 : cmp(a[0], b[0])))) {
        r.by_category[c ?? SIN_CATEGORIA] = cents / 100;
        r.total = pyRound(r.total + cents / 100, 2);
      }
      out.set(k, r);
    }
    return out;
  }

  private byYear() {
    return [...this.aggregate([...this.db.expenses.values()], (e) => year(e.date))].sort((a, b) => a[0] - b[0])
      .map(([y, r]) => ({ year: y, ...r }));
  }

  private byMonth(y: number) {
    const agg = this.aggregate([...this.db.expenses.values()].filter((e) => year(e.date) === y), (e) => month(e.date));
    return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(agg.get(i + 1) ?? { total: 0, by_category: {} }) }));
  }

  private records(nameless = SIN_CATEGORIA) {
    return this.allExpenses().map((e) => ({ category: this.catName(e.category_id) ?? nameless, day: e.date,
      period_start: e.period_start, period_end: e.period_end }));
  }

  private missing() {
    return missingInvoices(this.records(), this.ctx.today());
  }

  private coverage(y: number) {
    const start = `${y}-01-01`, end = `${y}-12-31`;
    const items = this.allExpenses().filter((e) => e.period_start && e.period_end && e.period_start <= end && e.period_end >= start)
      .sort((a, b) => cmp(a.period_start!, b.period_start!))
      .map((e) => {
        const c = e.category_id == null ? undefined : this.db.categories.get(e.category_id);
        return { id: e.id, category: c?.name ?? SIN_CATEGORIA, color: c?.color ?? null, provider: e.provider, description: e.description,
          amount: e.amount_cents / 100, date: e.date, period_start: e.period_start, period_end: e.period_end, document_id: e.document_id };
      });
    const colors = new Map([...this.db.categories.values()].map((c) => [c.name, c.color]));
    const gaps = [];
    for (const m of this.missing()) {
      const g: Record<string, unknown> = { ...m };
      if (!m.period_from) {
        const [yy, mo] = m.month.split("-").map(Number);
        g.period_from = `${m.month}-01`;
        g.period_to = addDays(`${yy + Math.floor(mo / 12)}-${String((mo % 12) + 1).padStart(2, "0")}-01`, -1);
        g.whole_month = true;
      }
      if ((g.period_from as string) <= end && (g.period_to as string) >= start) gaps.push({ ...g, color: colors.get(m.category) ?? null });
    }
    return { items, gaps };
  }

  private breakdown() {
    const rows = new Map<string, { year: number; month: number; category: string; concept: string; cents: number }>();
    const colors: Record<string, string | null> = {};
    for (const e of this.allExpenses()) {
      const c = e.category_id == null ? undefined : this.db.categories.get(e.category_id);
      const cat = c?.name ?? SIN_CATEGORIA;
      colors[cat] = c?.color ?? null;
      const k = [year(e.date), month(e.date), cat, concept(e)] as const;
      const key = JSON.stringify(k);
      const r = rows.get(key) ?? { year: k[0], month: k[1], category: k[2], concept: k[3], cents: 0 };
      r.cents += e.amount_cents;
      rows.set(key, r);
    }
    const sorted = [...rows.values()].sort((a, b) => a.year - b.year || a.month - b.month || cmp(a.category, b.category) || cmp(a.concept, b.concept));
    return { colors, rows: sorted.map(({ cents, ...r }) => ({ ...r, amount: cents / 100 })) };
  }

  private car() {
    const car = this.allExpenses().filter((e) => this.catName(e.category_id) === "Coche");
    const kinds = carKinds(car.map((e) => ({ ...e, tagNames: this.tagNames(e) })));
    return { kinds: KINDS, items: [...car].sort(byNewest).map((e) => ({
      id: e.id, date: e.date, amount: e.amount_cents / 100, description: e.description, provider: e.provider, source: e.source,
      kind: kinds.get(e.id) })) };
  }

  private savings() {
    const months = new Map<string, { year: number; month: number; income: number; expense: number; income_by_kind: Record<string, number> }>();
    const row = (y: number, m: number) => {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      if (!months.has(k)) months.set(k, { year: y, month: m, income: 0, expense: 0, income_by_kind: {} });
      return months.get(k)!;
    };
    const from = `${SAVINGS_FROM_YEAR}-01-01`;
    const exp = new Map<string, number>();
    for (const e of this.db.expenses.values()) if (e.date >= from) exp.set(e.date.slice(0, 7), (exp.get(e.date.slice(0, 7)) ?? 0) + e.amount_cents);
    for (const [k, cents] of [...exp].sort()) row(year(`${k}-01`), month(`${k}-01`)).expense = cents / 100;
    const inc = new Map<string, number>();
    for (const i of this.db.incomes.values()) {
      if (i.date >= from) inc.set(`${i.date.slice(0, 7)}\u0000${i.kind}`, (inc.get(`${i.date.slice(0, 7)}\u0000${i.kind}`) ?? 0) + i.amount_cents);
    }
    for (const [k, cents] of [...inc].sort((a, b) => cmp(a[0], b[0]))) {
      const [ym, kind] = k.split("\u0000");
      const r = row(year(`${ym}-01`), month(`${ym}-01`));
      r.income = pyRound(r.income + cents / 100, 2);
      r.income_by_kind[kind] = cents / 100;
    }
    return [...months.keys()].sort().map((k) => months.get(k)!);
  }

  // ---------- revisar ----------
  private hidden = () => new Set(this.db.setting<string[]>(DISMISSED_KEY) ?? []);
  private keys = (body: unknown) => ((body as { keys?: unknown })?.keys as string[] | undefined)?.filter((k) => typeof k === "string") ?? [];

  private review(includeDismissed: boolean) {
    const expenses = this.expensesAsc().map(this.rexp);
    return buildReview(expenses, [...this.db.incomes.values()], [...this.db.documents.values()], this.hidden(), includeDismissed, this.ctx.today());
  }

  private setDismissed(change: (h: Set<string>) => Set<string>) {
    const next = [...change(this.hidden())].sort(cmp);
    this.db.setSetting(DISMISSED_KEY, next);
    return { dismissed: next.length };
  }

  // ---------- banco ----------
  private async bankPreview(form: FormData) {
    const files = (form?.getAll("files") ?? []) as File[];
    const movements = new Map<string, Movement>();
    const perFile: { name: string; movements: number; new: number }[] = [];
    const spans: [string, string][] = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) throw new HttpError(413, `${f.name} supera 20 MB`);
      let found: Movement[];
      try {
        found = await parseWorkbook(new Uint8Array(await f.arrayBuffer()), f.name);
      } catch (err) {
        if (err instanceof BankFileError) throw new HttpError(400, err.message);
        throw err;
      }
      const fresh = found.filter((m) => !movements.has(m.key));
      for (const m of fresh) movements.set(m.key, m);
      perFile.push({ name: f.name, movements: found.length, new: fresh.length });
      const dates = found.map((m) => m.date).sort();
      spans.push([dates[0], dates.at(-1)!]);
    }
    const items = [...movements.values()].sort((a, b) => cmp(b.date, a.date));
    const learned = this.db.setting<Record<string, string>>(LEARNED_KEY) ?? {};
    for (const m of items) if (m.amount < 0 && m.group in learned) m.category = learned[m.group];
    const imported = new Set([...this.db.expenses.values(), ...this.db.incomes.values()].map((x) => x.external_id).filter((x): x is string => Boolean(x)));
    const unmatched = reconcile(items, spans, this.allExpenses().map((e) => ({ ...e, category: this.catName(e.category_id) })), imported, this.ctx.today());
    const excluded = this.db.setting<string[]>(SETTING_KEY) ?? [...DEFAULT_EXCLUDED];
    const excludedIncome = this.db.setting<string[]>(INCOME_SETTING_KEY) ?? [...DEFAULT_EXCLUDED_INCOME];
    const kinds = new Map<string, { count: number; total: number }>();
    const incomeKinds = new Map(INCOME_KINDS.map((k) => [k, { count: 0, total: 0 }]));
    for (const m of items) {
      const k = m.amount > 0 ? incomeKinds.get(m.income_kind!)! : kinds.get(m.kind) ?? kinds.set(m.kind, { count: 0, total: 0 }).get(m.kind)!;
      k.count += 1;
      k.total = pyRound(k.total + m.amount, 2);
    }
    return {
      files: perFile, unmatched_invoices: unmatched, excluded_kinds: excluded,
      kinds: [...kinds].sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, ...v, excluded: excluded.includes(name) })),
      excluded_income_kinds: excludedIncome,
      income_kinds: [...incomeKinds].filter(([, v]) => v.count).map(([name, v]) => ({ name, ...v, excluded: excludedIncome.includes(name) })),
      movements: items.map((m) => ({ ...m, importable: m.status !== "importado" })),
    };
  }

  private bankImport(body: unknown) {
    const b = (body ?? {}) as { movements?: Record<string, unknown>[]; session?: string; excluded_kinds?: string[]; excluded_income_kinds?: string[] };
    const movements = b.movements ?? [];
    if (b.session && !/^[A-Za-z0-9]{1,20}$/.test(b.session)) throw new HttpError(422, "Sesión no válida");
    for (const m of movements) {
      if (typeof m.key !== "string" || m.key.length < 8 || m.key.length > 64) throw new HttpError(422, "Movimiento sin huella");
      if (!(Number(m.amount) > 0)) throw new HttpError(422, "Importe no válido");
      isoDate(m.date, "date", true);
    }
    if (b.excluded_kinds) this.db.setSetting(SETTING_KEY, b.excluded_kinds);
    if (b.excluded_income_kinds) this.db.setSetting(INCOME_SETTING_KEY, b.excluded_income_kinds);
    this.learn(Object.fromEntries(movements.filter((m) => m.category && (m.direction ?? "gasto") === "gasto")
      .map((m) => [(m.group as string) || merchantKey(String(m.description)), m.category as string])));
    const already = new Set([...this.db.expenses.values(), ...this.db.incomes.values()].map((x) => x.external_id).filter(Boolean));
    const hex = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const batch = `${b.session || hex()}.${hex()}`;
    let imported = 0;
    for (const m of movements) {
      if (already.has(m.key as string)) continue;
      already.add(m.key as string);
      imported++;
      const common = { date: m.date as string, amount_cents: pyRound(Number(m.amount) * 100), description: String(m.description ?? "").slice(0, 255),
        source: "banco", notes: (m.notes as string) || null, external_id: m.key as string, import_batch: batch, created_at: this.ctx.now() };
      if (m.direction === "ingreso") {
        this.db.create("income", { ...common, kind: (m.income_kind as string) || "Otros ingresos" });
        continue;
      }
      this.db.create("expense", { ...common, provider: String(m.description ?? "").slice(0, 120), reviewed: true, invoice_number: null,
        category_id: this.categoryFor((m.category as string) || "Otros").id, period_start: (m.period_start as string) ?? null,
        period_end: (m.period_end as string) ?? null, document_id: null, tag_ids: [] });
    }
    return { imported, skipped: movements.length - imported, keys: movements.map((m) => m.key), batch };
  }

  private bankImports() {
    const batches = new Map<string, { batch: string; session: string; created_at: string; count: number; incomes: number;
      date_from: string; date_to: string; total: number; income_total: number }>();
    const groups: [ExpenseRow[] | IncomeRow[], "gastos" | "ingresos"][] = [
      [[...this.db.expenses.values()], "gastos"], [[...this.db.incomes.values()], "ingresos"]];
    for (const [rows, sign] of groups) {
      const byBatch = new Map<string, (ExpenseRow | IncomeRow)[]>();
      for (const r of rows) if (r.source === "banco" && r.import_batch) byBatch.set(r.import_batch, [...(byBatch.get(r.import_batch) ?? []), r]);
      for (const [b, list] of [...byBatch].sort((x, y) => cmp(x[0], y[0]))) { // como GROUP BY: por lote
        const at = list.map((r) => r.created_at ?? "").reduce((a, c) => (c < a ? c : a));
        const d1 = list.map((r) => r.date).reduce((a, c) => (c < a ? c : a));
        const d2 = list.map((r) => r.date).reduce((a, c) => (c > a ? c : a));
        const cents = list.reduce((s, r) => s + r.amount_cents, 0);
        const r = batches.get(b) ?? { batch: b, session: b.split(".")[0], created_at: at, count: 0, incomes: 0, date_from: d1, date_to: d2, total: 0, income_total: 0 };
        r.created_at = at < r.created_at ? at : r.created_at;
        r.date_from = d1 < r.date_from ? d1 : r.date_from;
        r.date_to = d2 > r.date_to ? d2 : r.date_to;
        if (sign === "gastos") { r.count = list.length; r.total = cents / 100; } else { r.incomes = list.length; r.income_total = cents / 100; }
        batches.set(b, r);
      }
    }
    return [...batches.values()].sort((a, b) => cmp(b.created_at, a.created_at));
  }

  private bankUndo(body: unknown) {
    const list = new Set(((body as { batches?: string[] })?.batches ?? []));
    if (!list.size) throw new HttpError(422, "Indica qué importaciones deshacer");
    let deleted = 0;
    for (const e of [...this.db.expenses.values()]) if (e.source === "banco" && e.import_batch && list.has(e.import_batch)) { this.db.remove("expense", e); deleted++; }
    for (const i of [...this.db.incomes.values()]) if (i.source === "banco" && i.import_batch && list.has(i.import_batch)) { this.db.remove("income", i); deleted++; }
    return { deleted };
  }

  // ---------- actividad ----------
  private activity(q: URLSearchParams) {
    const limit = Math.min(int(q.get("limit")) ?? 50, 200);
    const before = int(q.get("before"));
    const user = q.get("user");
    const cut = before !== null ? this.db.logs.get(before) : undefined;
    return [...this.db.logs.values()]
      .filter((l) => (!user || l.user === user) && (!cut || l.seq < cut.seq || (l.seq === cut.seq && l.id < cut.id)))
      .sort((a, b) => b.seq - a.seq || b.id - a.id).slice(0, limit)
      .map((l) => ({ id: l.id, at: l.at, user: l.user, ip: "", action: l.action, summary: l.summary, details: l.details ?? [] }));
  }
}

// ---------- registro de movimientos (como backend/app/audit.py) ----------
const ACTIONS: [string, RegExp, string][] = [
  ["POST", /^\/api\/expenses$/, "Nuevo gasto"], ["PUT", /^\/api\/expenses\/\d+$/, "Editar gasto"],
  ["PATCH", /^\/api\/expenses\/\d+\/review$/, "Marca de revisar"], ["DELETE", /^\/api\/expenses\/\d+$/, "Borrar gasto"],
  ["POST", /^\/api\/incomes$/, "Nuevo ingreso"], ["PUT", /^\/api\/incomes\/\d+$/, "Editar ingreso"],
  ["DELETE", /^\/api\/incomes\/\d+$/, "Borrar ingreso"], ["POST", /^\/api\/tags$/, "Nueva etiqueta"],
  ["PUT", /^\/api\/tags\/\d+$/, "Editar etiqueta"], ["DELETE", /^\/api\/tags\/\d+$/, "Borrar etiqueta"],
  ["POST", /^\/api\/tags\/\d+\/apply$/, "Poner o quitar etiqueta"], ["POST", /^\/api\/categories$/, "Nueva categoría"],
  ["PUT", /^\/api\/categories\/\d+$/, "Editar categoría"], ["DELETE", /^\/api\/categories\/\d+$/, "Borrar categoría"],
  ["POST", /^\/api\/documents.*$/, "Subir PDF"], ["DELETE", /^\/api\/documents\/\d+$/, "Borrar PDF"],
  ["POST", /^\/api\/bank\/import$/, "Importar Excel del banco"], ["POST", /^\/api\/bank\/imports\/undo$/, "Deshacer importación"],
  ["POST", /^\/api\/backup\/import$/, "Restaurar copia de seguridad"], ["POST", /^\/api\/review\/dismiss$/, "Descartar aviso"],
  ["POST", /^\/api\/review\/restore$/, "Volver a mostrar avisos"], ["PUT", /^\/api\/prefs$/, "Ordenar pestañas"],
];
const ENTITY: Record<string, string> = { expense: "gasto", income: "ingreso", tag: "etiqueta", category: "categoría", document: "PDF", setting: "ajuste" };
const PLURAL: Record<string, string> = { gasto: "gastos", ingreso: "ingresos", etiqueta: "etiquetas", categoría: "categorías", PDF: "PDF", ajuste: "ajustes" };
const OPS: Record<string, string> = { alta: "altas", cambio: "cambios", borrado: "borrados" };
const SKIP = new Set(["id", "uid", "version", "seq", "updated_by", "created_at", "uploaded_at", "extracted", "category_id", "document_id", "tag_ids"]);

export function actionName(method: string, path: string) {
  return ACTIONS.find(([m, re]) => m === method && re.test(path))?.[2] ?? `${method} ${path}`;
}

/** Entrada de actividad para los cambios de una petición (o null si no cambió nada). */
export function describeChanges(db: Db, ops: { op: "put" | "del"; kind: Kind; row: Row; before?: Row }[], method: string, path: string, user: string, at: string) {
  const changes: Record<string, unknown>[] = [];
  let total = 0;
  const label = (kind: Kind, r: Record<string, unknown>) => {
    if (kind === "expense" || kind === "income") {
      const d = r.date as string;
      return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} · ${r.description || r.provider || "—"} · ${((r.amount_cents as number) / 100).toFixed(2)} €`;
    }
    return String(kind === "document" ? r.original_name : kind === "setting" ? r.key : r.name);
  };
  const name = (t: Map<number, { name: string }>, id: unknown) => (id == null ? null : t.get(id as number)?.name ?? null);
  for (const o of ops) {
    if (o.kind === "log") continue;
    const r = o.row as unknown as Record<string, unknown>;
    const b = o.before as unknown as Record<string, unknown> | undefined;
    const op = o.op === "del" ? "borrado" : b ? "cambio" : "alta";
    const change: Record<string, unknown> = { op, entity: ENTITY[o.kind], id: o.row.id, label: label(o.kind, r) };
    if (op === "cambio" && b) {
      const diff: Record<string, [unknown, unknown]> = {};
      for (const k of Object.keys(r)) {
        if (SKIP.has(k) || JSON.stringify(r[k]) === JSON.stringify(b[k])) continue;
        if (k === "amount_cents") diff.importe = [(b[k] as number) / 100, (r[k] as number) / 100];
        else diff[k] = [b[k] ?? null, r[k] ?? null];
      }
      if (o.kind === "expense") {
        if (r.category_id !== b.category_id) diff.category = [name(db.categories, b.category_id), name(db.categories, r.category_id)];
        const added = (r.tag_ids as number[]).filter((t) => !(b.tag_ids as number[]).includes(t)).map((t) => name(db.tags, t)).filter(Boolean);
        const removed = (b.tag_ids as number[]).filter((t) => !(r.tag_ids as number[]).includes(t)).map((t) => name(db.tags, t)).filter(Boolean);
        if (added.length) diff["etiquetas +"] = [null, added.join(", ")];
        if (removed.length) diff["etiquetas −"] = [removed.join(", "), null];
      }
      if (!Object.keys(diff).length) continue;
      change.changes = diff;
    }
    total++;
    if (changes.length < MAX_DETAILS) changes.push(change);
  }
  if (!changes.length) return null;
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(`${c.op}|${c.entity}`, (counts.get(`${c.op}|${c.entity}`) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => {
    const [op, entity] = k.split("|");
    return n === 1 ? `1 ${op} de ${entity}` : `${n} ${OPS[op]} de ${PLURAL[entity] ?? entity}`;
  });
  if (total > changes.length) parts.push(`${total} cambios en total`);
  return { at, user, action: actionName(method, path), summary: parts.join(" · ").slice(0, 255), details: changes } satisfies Omit<LogRow, keyof Row>;
}
