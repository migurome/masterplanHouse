/**
 * Paso de la app local a la nube: lee la copia de seguridad (ZIP de Ajustes → Copia de seguridad) y la
 * convierte en registros con ids nuevos (uuid). Las referencias (categoría, etiquetas, PDF) pasan a esos ids.
 * Todo ocurre en el navegador; lo que sube ya va cifrado.
 */
import { unzipSync } from "fflate";
import type { Kind, NewRecord } from "./store";

interface BackupCategory { name: string; color: string | null }
interface BackupDocument {
  id: number; original_name: string; sha256: string; status: string; error: string | null;
  extracted: unknown; uploaded_at: string | null; file: string;
}
interface BackupExpense {
  date: string; amount_cents: number; description: string; provider: string | null; invoice_number: string | null;
  period_start: string | null; period_end: string | null; source: string; reviewed: boolean; notes: string | null;
  external_id: string | null; import_batch: string | null; category: string | null; document_id: number | null; tags?: string[];
}
interface BackupIncome {
  date: string; amount_cents: number; description: string; kind: string; source: string; notes: string | null;
  external_id: string | null; import_batch: string | null;
}
export interface Backup {
  format: string; version: number; exported_at?: string; includes_pdfs?: boolean;
  categories: BackupCategory[]; tags?: BackupCategory[]; documents: BackupDocument[];
  expenses: BackupExpense[]; incomes?: BackupIncome[];
}

// Lo que se guarda cifrado en la nube
export interface CategoryData { name: string; color: string | null }
export type TagData = CategoryData;
export interface DocumentData { original_name: string; sha256: string; status: string; error: string | null; extracted: unknown; uploaded_at: string | null; has_file: boolean }
export interface ExpenseData extends Omit<BackupExpense, "category" | "document_id" | "tags"> {
  category_id: string | null; document_id: string | null; tag_ids: string[];
}
export type IncomeData = BackupIncome;

export interface Plan {
  records: NewRecord[];
  files: { id: string; bytes: Uint8Array }[];
  counts: Partial<Record<Kind, number>>;
  missingFiles: number; // PDF que figuran en la copia pero no vienen dentro
  exportedAt: string | null;
}

export class BackupFormatError extends Error {}

export function readBackupZip(zip: Uint8Array): { backup: Backup; files: Record<string, Uint8Array> } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new BackupFormatError("El archivo no es un ZIP válido.");
  }
  const json = files["backup.json"];
  if (!json) throw new BackupFormatError("El ZIP no es una copia de seguridad de the Master Plan (falta backup.json).");
  const backup = JSON.parse(new TextDecoder().decode(json)) as Backup;
  if (backup.format !== "gastos-casa" || backup.version > 1) throw new BackupFormatError("Copia de otro formato o de una versión más nueva.");
  return { backup, files };
}

export function planMigration(backup: Backup, files: Record<string, Uint8Array>, newId: () => string = () => crypto.randomUUID()): Plan {
  const records: NewRecord[] = [];
  const out: Plan["files"] = [];
  const add = (kind: Kind, data: unknown) => {
    const id = newId();
    records.push({ id, kind, data });
    return id;
  };
  const byName = (items: BackupCategory[] | undefined, kind: Kind) =>
    new Map((items ?? []).map((c) => [c.name, add(kind, { name: c.name, color: c.color } satisfies CategoryData)]));

  const categories = byName(backup.categories, "category");
  const tags = byName(backup.tags, "tag");

  let missingFiles = 0;
  const documents = new Map<number, string>();
  for (const d of backup.documents) {
    const bytes = files[d.file];
    if (!bytes) missingFiles++;
    const id = add("document", {
      original_name: d.original_name, sha256: d.sha256, status: d.status, error: d.error,
      extracted: d.extracted, uploaded_at: d.uploaded_at, has_file: Boolean(bytes),
    } satisfies DocumentData);
    documents.set(d.id, id);
    if (bytes) out.push({ id, bytes });
  }

  for (const { category, document_id, tags: tagNames, ...rest } of backup.expenses) {
    add("expense", {
      ...rest,
      category_id: category ? categories.get(category) ?? null : null,
      document_id: document_id != null ? documents.get(document_id) ?? null : null,
      tag_ids: (tagNames ?? []).map((n) => tags.get(n)).filter((id): id is string => Boolean(id)),
    } satisfies ExpenseData);
  }
  for (const i of backup.incomes ?? []) add("income", { ...i } satisfies IncomeData);

  const counts: Plan["counts"] = {};
  for (const r of records) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return { records, files: out, counts, missingFiles, exportedAt: backup.exported_at ?? null };
}
