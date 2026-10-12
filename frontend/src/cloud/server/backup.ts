/**
 * Copias de seguridad en el navegador, con el mismo formato que backend/app/backup.py (ZIP con backup.json y
 * los PDF en documentos/). Restaurar sirve también para pasar los datos de la app local a la nube: además de lo
 * que restauraba Python, aplica los ajustes (avisos descartados, categorías aprendidas del banco, pestañas).
 */
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Ctx } from "./api";
import { HttpError } from "./api";
import type { Db, DocumentRow, ExpenseRow, IncomeRow } from "./db";
import { fold } from "./py";

const FORMAT_VERSION = 1;
const EXPENSE_FIELDS = ["date", "amount_cents", "description", "provider", "invoice_number", "period_start", "period_end",
  "source", "reviewed", "notes", "external_id", "import_batch"] as const;
const INCOME_FIELDS = ["date", "amount_cents", "description", "kind", "source", "notes", "external_id", "import_batch"] as const;
const NO_NUMBER = new Set(["", "na", "n/a", "n.a.", "-", "--", "s/n", "sn", "sin numero", "sin número", "ninguno", "none", "0"]);
const cleanNumber = (v: unknown) => {
  const s = String(v ?? "").trim();
  return NO_NUMBER.has(s.toLowerCase()) ? null : s;
};
const byOldest = (a: { seq: number; id: number }, b: { seq: number; id: number }) => a.seq - b.seq || a.id - b.id;
const pick = <T extends object>(o: T, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k] ?? null]));

export async function exportBackup(db: Db, ctx: Ctx, includePdfs: boolean, onProgress?: (msg: string) => void): Promise<Blob> {
  const docs = [...db.documents.values()].sort(byOldest);
  const settings: Record<string, unknown> = {};
  for (const s of [...db.settingRows.values()].sort(byOldest)) settings[s.key] = s.value;
  const data = {
    format: "gastos-casa", version: FORMAT_VERSION, exported_at: new Date().toISOString().slice(0, 19) + "+00:00",
    includes_pdfs: includePdfs,
    categories: [...db.categories.values()].sort(byOldest).map((c) => ({ name: c.name, color: c.color })),
    tags: [...db.tags.values()].sort(byOldest).map((t) => ({ name: t.name, color: t.color })),
    documents: docs.map((d) => ({ id: d.id, original_name: d.original_name, sha256: d.sha256, status: d.status, error: d.error,
      extracted: d.extracted, uploaded_at: d.uploaded_at, file: `documentos/${d.uid}.pdf` })),
    incomes: [...db.incomes.values()].sort(byOldest).map((i) => ({ id: i.id, created_at: i.created_at, ...pick(i, INCOME_FIELDS) })),
    expenses: [...db.expenses.values()].sort(byOldest).map((e) => ({
      id: e.id, created_at: e.created_at, ...pick(e, EXPENSE_FIELDS),
      category: e.category_id == null ? null : db.categories.get(e.category_id)?.name ?? null, document_id: e.document_id,
      tags: e.tag_ids.map((t) => db.tags.get(t)?.name).filter(Boolean).sort(),
    })),
    settings,
  };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { "backup.json": strToU8(JSON.stringify(data, null, 1)) };
  if (includePdfs && ctx.files) {
    let n = 0;
    for (const d of docs.filter((d) => d.has_file)) {
      onProgress?.(`Descargando PDF ${++n} de ${docs.length}…`);
      try {
        files[`documentos/${d.uid}.pdf`] = [await ctx.files.get(d.uid), { level: 0 }]; // los PDF ya van comprimidos
      } catch {
        /* PDF que no está en el almacén: la copia sigue sin él */
      }
    }
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

interface Stats { categorias: number; documentos: number; gastos: number; gastos_omitidos: number; ingresos: number }

export async function importBackup(db: Db, ctx: Ctx, raw: Uint8Array, mode: string, onProgress?: (msg: string) => void): Promise<Stats> {
  if (mode !== "merge" && mode !== "replace") throw new HttpError(400, "Modo desconocido");
  let zip: Record<string, Uint8Array>;
  let data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    zip = unzipSync(raw);
    data = JSON.parse(new TextDecoder().decode(zip["backup.json"]));
  } catch {
    throw new HttpError(400, "El archivo no es una copia de seguridad válida");
  }
  if (data.format !== "gastos-casa" || (data.version ?? 0) > FORMAT_VERSION) {
    throw new HttpError(400, "Copia de seguridad de otro formato o de una versión más nueva");
  }
  const stats: Stats = { categorias: 0, documentos: 0, gastos: 0, gastos_omitidos: 0, ingresos: 0 };
  const now = ctx.now();

  if (mode === "replace") {
    for (const d of [...db.documents.values()]) { db.remove("document", d); await ctx.files?.del(d.uid).catch(() => {}); }
    for (const e of [...db.expenses.values()]) db.remove("expense", e);
    for (const t of [...db.tags.values()]) db.remove("tag", t);
    for (const i of [...db.incomes.values()]) db.remove("income", i);
    for (const c of [...db.categories.values()]) db.remove("category", c);
  }

  const cats = new Map([...db.categories.values()].map((c) => [fold(c.name), c]));
  for (const c of data.categories ?? []) {
    if (!cats.has(fold(c.name))) { cats.set(fold(c.name), db.create("category", { name: c.name, color: c.color ?? null })); stats.categorias++; }
  }
  const tags = new Map([...db.tags.values()].map((t) => [fold(t.name), t]));
  for (const t of data.tags ?? []) if (!tags.has(fold(t.name))) tags.set(fold(t.name), db.create("tag", { name: t.name, color: t.color ?? null }));

  // Documentos (por huella: el mismo PDF nunca se duplica)
  const known = new Map([...db.documents.values()].map((d) => [d.sha256, d]));
  const docMap = new Map<number, DocumentRow>();
  const uploads: [DocumentRow, Uint8Array][] = [];
  for (const d of data.documents ?? []) {
    const have = known.get(d.sha256);
    if (have) { docMap.set(d.id, have); continue; }
    const bytes = zip[d.file];
    if (!bytes) continue; // copia sin PDF y el archivo no está en la nube
    const doc = db.create("document", { original_name: d.original_name, sha256: d.sha256, status: d.status, error: d.error ?? null,
      extracted: d.extracted ?? null, uploaded_at: d.uploaded_at ?? now, has_file: true });
    known.set(d.sha256, doc);
    docMap.set(d.id, doc);
    uploads.push([doc, bytes]);
    stats.documentos++;
  }
  let done = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < uploads.length) {
      const [doc, bytes] = uploads[next++];
      await ctx.files?.put(doc.uid, bytes);
      onProgress?.(`Subiendo PDF cifrados: ${++done} de ${uploads.length}`);
    }
  }));

  // Gastos: en "merge" se omiten los que ya existen (mismo PDF, misma factura o mismo apunte)
  const existing = [...db.expenses.values()];
  const seenDocs = new Set(existing.map((e) => e.document_id).filter((x) => x != null));
  const seenKeys = new Set(existing.map((e) => `${e.date}|${e.amount_cents}|${e.description}`));
  const seenExt = new Set(existing.map((e) => e.external_id).filter(Boolean));
  const seenInv = new Set(existing.filter((e) => cleanNumber(e.invoice_number)).map((e) => `${fold(e.provider ?? "")}|${e.invoice_number}`));
  const expMap = new Map<number, number>();
  for (const e of data.expenses ?? []) {
    const number = cleanNumber(e.invoice_number);
    const doc = e.document_id != null ? docMap.get(e.document_id) : undefined;
    const key = `${e.date}|${e.amount_cents}|${e.description}`;
    if ((doc && seenDocs.has(doc.id)) || seenKeys.has(key) || (number && seenInv.has(`${fold(e.provider ?? "")}|${number}`))
      || (e.external_id && seenExt.has(e.external_id))) {
      stats.gastos_omitidos++;
      continue;
    }
    const row = db.create("expense", {
      ...(pick(e, EXPENSE_FIELDS) as Omit<ExpenseRow, "id">), invoice_number: number, reviewed: e.reviewed ?? true,
      description: e.description ?? "", source: e.source ?? "manual", created_at: e.created_at ?? now,
      category_id: e.category ? cats.get(fold(e.category))?.id ?? null : null, document_id: doc?.id ?? null,
      tag_ids: (e.tags ?? []).map((n: string) => tags.get(fold(n))?.id).filter((x: number | undefined): x is number => x != null),
    });
    if (e.id != null) expMap.set(e.id, row.id);
    seenKeys.add(key);
    if (e.external_id) seenExt.add(e.external_id);
    if (doc) seenDocs.add(doc.id);
    stats.gastos++;
  }

  const have = new Set([...db.incomes.values()].map((i) => `${i.date}|${i.amount_cents}|${i.description}`));
  const haveExt = new Set([...db.incomes.values()].map((i) => i.external_id).filter(Boolean));
  const incMap = new Map<number, number>();
  for (const i of data.incomes ?? []) {
    if (have.has(`${i.date}|${i.amount_cents}|${i.description}`) || (i.external_id && haveExt.has(i.external_id))) continue;
    const row = db.create("income", { ...(pick(i, INCOME_FIELDS) as Omit<IncomeRow, "id">), kind: i.kind ?? "Otros ingresos", description: i.description ?? "",
      source: i.source ?? "manual", created_at: i.created_at ?? now });
    if (i.id != null) incMap.set(i.id, row.id);
    stats.ingresos++;
  }

  applySettings(db, data.settings ?? {}, { expense: expMap, income: incMap, doc: new Map([...docMap].map(([k, v]) => [k, v.id])) });
  return stats;
}

/** Ajustes de la copia: los avisos descartados se pasan a los ids nuevos; lo que ya hay en la nube manda. */
function applySettings(db: Db, settings: Record<string, unknown>, ids: { expense: Map<number, number>; income: Map<number, number>; doc: Map<number, number> }) {
  const exp = (n: string) => String(ids.expense.get(Number(n)) ?? n);
  const remap = (key: string) => {
    let m;
    if ((m = key.match(/^(pend|uncat|otros|raro|car):(\d+)$/))) return `${m[1]}:${exp(m[2])}`;
    if ((m = key.match(/^(dup|overlap):(\d+)-(\d+)$/))) return `${m[1]}:${exp(m[2])}-${exp(m[3])}`;
    if ((m = key.match(/^income:(\d+)$/))) return `income:${ids.income.get(Number(m[1])) ?? m[1]}`;
    if ((m = key.match(/^doc:(\d+)$/))) return `doc:${ids.doc.get(Number(m[1])) ?? m[1]}`;
    return key;
  };
  for (const [key, value] of Object.entries(settings)) {
    if (key === "categories_added") continue;
    const current = db.setting<unknown>(key);
    if (key === "review_dismissed" && Array.isArray(value)) {
      db.setSetting(key, [...new Set([...((current as string[]) ?? []), ...value.map(remap)])].sort());
    } else if (key === "bank_category_by_group" && value && typeof value === "object") {
      db.setSetting(key, { ...(value as object), ...((current as object) ?? {}) });
    } else if (current === undefined) {
      db.setSetting(key, value);
    }
  }
}
