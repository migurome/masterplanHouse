export interface Category { id: number; name: string; color: string | null }
export interface Tag { id: number; name: string; color: string | null }
export interface ReviewItem {
  key: string; title: string; detail: string; amount: number | null; date: string | null;
  expense_ids: number[]; link: string | null; dismissed: boolean;
}
export interface ReviewSection { id: string; title: string; help: string; level: "alta" | "media" | "baja"; dismissable: boolean; items: ReviewItem[] }
export interface ActivityChange { op: string; entity: string; id?: number | string | null; label: string; count?: number; changes?: Record<string, [unknown, unknown]> }
export interface ActivityEntry { id: number; at: string | null; user: string; ip: string; action: string; summary: string; details: ActivityChange[] }
export interface Prefs { nav?: string[] }
export interface ReviewData { total: number; dismissed: number; sections: ReviewSection[] }
export interface TagUsage extends Tag { count: number; total: number }

export interface Expense {
  id: number;
  date: string;
  amount: number;
  description: string;
  provider: string | null;
  invoice_number: string | null;
  period_start: string | null;
  period_end: string | null;
  category_id: number | null;
  category: string | null;
  source: "manual" | "pdf";
  reviewed: boolean;
  notes: string | null;
  document_id: number | null;
  tags: Tag[];
  concept: string; // comercio o proveedor con el que se agrupa
  similar_updated?: number; // al guardar: gastos parecidos que han cambiado de categoría con este
}

export type ExpenseInput = Omit<Expense, "id" | "category" | "source" | "document_id" | "tags" | "similar_updated" | "concept"> & {
  tag_ids?: number[];
};

export interface DocumentResult {
  id: number;
  original_name: string;
  status: "pendiente" | "procesado" | "error";
  error: string | null;
  expense_id: number | null;
  duplicate: boolean;
}

export interface YearStat { year: number; total: number; by_category: Record<string, number> }
export interface MonthStat { month: number; total: number; by_category: Record<string, number> }
export interface CoverageItem {
  id: number;
  category: string;
  color: string | null;
  provider: string | null;
  description: string;
  amount: number;
  date: string;
  period_start: string;
  period_end: string;
  document_id: number | null;
}
export interface CoverageGap extends MissingInvoice { color: string | null; whole_month?: boolean }
export interface Coverage { items: CoverageItem[]; gaps: CoverageGap[] }

export interface BankMovement {
  key: string;
  date: string;
  amount: number; // con signo: negativo = sale dinero
  concept: string;
  detail: string;
  notes: string;
  kind: string;
  category: string | null;
  group: string; // comercio: los movimientos similares comparten categoría
  status: "nuevo" | "importado" | "duplicado";
  duplicate_of: RegisteredExpense | null; // gasto ya registrado con el mismo importe
  mismatch: RegisteredExpense | null; // factura cercana de la misma categoría con otro importe
  fills_gap: { category: string; month: string; period_from: string | null; period_to: string | null } | null;
  importable: boolean;
  income_kind: string | null; // solo en lo que entra en la cuenta
}
export interface RegisteredExpense {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  has_pdf: boolean;
}
export interface BankImportBatch {
  batch: string;
  session: string; // lo importado desde un mismo análisis del Excel
  created_at: string; // UTC
  count: number;
  incomes: number;
  income_total: number;
  date_from: string;
  date_to: string;
  total: number;
}
export interface Income { id: number; date: string; amount: number; description: string; kind: string; source: string; notes: string | null }
export type IncomeInput = Omit<Income, "id" | "source">;
export interface SavingsMonth { year: number; month: number; income: number; expense: number; income_by_kind: Record<string, number> }

export interface BankKind { name: string; count: number; total: number; excluded: boolean }
export interface BankPreview {
  files: { name: string; movements: number; new: number }[];
  unmatched_invoices: RegisteredExpense[]; // facturas en las fechas del Excel sin cargo en el banco
  excluded_kinds: string[];
  kinds: BankKind[];
  income_kinds: BankKind[];
  excluded_income_kinds: string[];
  movements: BankMovement[];
}
export interface BankImportRow {
  key: string;
  date: string;
  amount: number;
  description: string;
  category: string | null;
  notes: string | null;
  group: string;
  direction: "gasto" | "ingreso";
  income_kind?: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

export interface BreakdownRow { year: number; month: number; category: string; concept: string; amount: number }
export interface Breakdown { colors: Record<string, string | null>; rows: BreakdownRow[] }

export interface CarExpense { id: number; date: string; amount: number; description: string; provider: string | null; source: string; kind: string }
export interface CarData { kinds: string[]; items: CarExpense[] }

export interface MissingInvoice {
  month: string;
  category: string;
  cadence: number;
  period_from?: string | null; // fechas sin factura (luz, gas, internet)
  period_to?: string | null;
}
export interface Summary { pending_review: number; years: number[] }

export interface BackupResult { categorias: number; documentos: number; gastos: number; gastos_omitidos: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

let documentUrl = (id: number) => `/api/documents/${id}/file`;
export function setDocumentUrlResolver(fn: (id: number) => string) {
  documentUrl = fn;
}

// En la nube los PDF van cifrados: se descargan y se descifran antes de enseñarlos
let documentLoader: ((id: number) => Promise<string>) | null = null;
export function setDocumentLoader(fn: ((id: number) => Promise<string>) | null) {
  documentLoader = fn;
}
/** Dirección para ver un PDF (en la nube, el PDF ya descifrado). */
export const loadDocumentUrl = (id: number) => (documentLoader ? documentLoader(id) : Promise.resolve(documentUrl(id)));

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(withQuery(path, query), init);
  if (res.status === 401 && !path.startsWith("/api/auth/login")) onUnauthorized();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* respuesta sin JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  me: () => request<{ username: string }>("GET", "/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ username: string }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),

  categories: () => request<Category[]>("GET", "/api/categories"),
  createCategory: (c: Omit<Category, "id">) => request<Category>("POST", "/api/categories", c),
  updateCategory: (id: number, c: Omit<Category, "id">) => request<Category>("PUT", `/api/categories/${id}`, c),
  deleteCategory: (id: number) => request<void>("DELETE", `/api/categories/${id}`),


  expenses: (q?: Query) => request<Expense[]>("GET", "/api/expenses", undefined, q),
  createExpense: (e: ExpenseInput) => request<Expense>("POST", "/api/expenses", e),
  updateExpense: (id: number, e: ExpenseInput, applySimilar = true) =>
    request<Expense>("PUT", `/api/expenses/${id}`, e, applySimilar ? undefined : { apply_similar: false }),
  similarExpenses: (id: number) => request<{ merchant: string; count: number }>("GET", `/api/expenses/${id}/similar`),
  tags: () => request<TagUsage[]>("GET", "/api/tags"),
  activity: (q?: Query) => request<ActivityEntry[]>("GET", "/api/activity", undefined, q),
  activityUsers: () => request<string[]>("GET", "/api/activity/users"),
  prefs: () => request<Prefs>("GET", "/api/prefs"),
  savePrefs: (p: Prefs) => request<Prefs>("PUT", "/api/prefs", p),
  review: (includeDismissed = false) => request<ReviewData>("GET", "/api/review", undefined, includeDismissed ? { include_dismissed: true } : undefined),
  reviewDismiss: (keys: string[]) => request<{ dismissed: number }>("POST", "/api/review/dismiss", { keys }),
  reviewRestore: (keys: string[]) => request<{ dismissed: number }>("POST", "/api/review/restore", { keys }),
  createTag: (t: Omit<Tag, "id">) => request<Tag>("POST", "/api/tags", t),
  updateTag: (id: number, t: Omit<Tag, "id">) => request<Tag>("PUT", `/api/tags/${id}`, t),
  deleteTag: (id: number) => request<void>("DELETE", `/api/tags/${id}`),
  applyTag: (id: number, expenseIds: number[], remove = false) =>
    request<{ changed: number }>("POST", `/api/tags/${id}/apply`, { expense_ids: expenseIds, remove }),
  setReview: (id: number, reviewed: boolean) => request<Expense>("PATCH", `/api/expenses/${id}/review`, { reviewed }),
  deleteExpense: (id: number) => request<void>("DELETE", `/api/expenses/${id}`),

  documents: (q?: Query) => request<DocumentResult[]>("GET", "/api/documents", undefined, q),
  uploadDocument: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<DocumentResult>("POST", "/api/documents", fd);
  },
  reprocessDocument: (id: number) => request<DocumentResult>("POST", `/api/documents/${id}/reprocess`),
  deleteDocument: (id: number) => request<void>("DELETE", `/api/documents/${id}`),
  documentUrl: (id: number) => documentUrl(id),

  statsYears: (q?: Query) => request<YearStat[]>("GET", "/api/stats/years", undefined, q),
  statsMonths: (q: Query) => request<MonthStat[]>("GET", "/api/stats/months", undefined, q),
  bankPreview: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request<BankPreview>("POST", "/api/bank/preview", fd);
  },
  bankImport: (movements: BankImportRow[], excludedKinds: string[], excludedIncomeKinds: string[], session: string) =>
    request<{ imported: number; skipped: number; keys: string[]; batch: string }>(
      "POST", "/api/bank/import", { movements, excluded_kinds: excludedKinds, excluded_income_kinds: excludedIncomeKinds, session }),
  bankImports: () => request<BankImportBatch[]>("GET", "/api/bank/imports"),
  bankUndo: (batches: string[]) => request<{ deleted: number }>("POST", "/api/bank/imports/undo", { batches }),
  statsBreakdown: () => request<Breakdown>("GET", "/api/stats/breakdown"),
  statsCar: () => request<CarData>("GET", "/api/stats/car"),
  incomes: (q?: Query) => request<Income[]>("GET", "/api/incomes", undefined, q),
  incomeKinds: () => request<string[]>("GET", "/api/incomes/kinds"),
  createIncome: (i: IncomeInput) => request<Income>("POST", "/api/incomes", i),
  updateIncome: (id: number, i: IncomeInput) => request<Income>("PUT", `/api/incomes/${id}`, i),
  deleteIncome: (id: number) => request<void>("DELETE", `/api/incomes/${id}`),
  statsSavings: () => request<SavingsMonth[]>("GET", "/api/stats/savings"),
  statsCoverage: (year: number) => request<Coverage>("GET", "/api/stats/coverage", undefined, { year }),
  statsMissing: (q?: Query) => request<MissingInvoice[]>("GET", "/api/stats/missing", undefined, q),
  backupExportUrl: (includePdfs: boolean) => `/api/backup/export?include_pdfs=${includePdfs}`,
  importBackup: (file: File, mode: "merge" | "replace") => {
    const fd = new FormData();
    fd.append("file", file);
    return request<BackupResult>("POST", `/api/backup/import?mode=${mode}`, fd);
  },
  summary: () => request<Summary>("GET", "/api/stats/summary"),
};
