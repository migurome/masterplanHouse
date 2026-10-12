/**
 * Base de datos en memoria del servidor del navegador: los registros descifrados, con ids numéricos para la web.
 * Cada cambio se apunta en `pending` y luego se guarda cifrado en Supabase (ver persist.ts).
 *
 * En Supabase las referencias (categoría, PDF, etiquetas) se guardan con el uuid del registro; aquí se usan ids
 * numéricos sacados del propio uuid (52 bits: estables entre sesiones y entre los dos usuarios).
 */

export type Kind = "category" | "tag" | "document" | "expense" | "income" | "setting" | "log";

export interface Row { id: number; uid: string; version: number; seq: number; updated_by?: string | null }
export interface CategoryRow extends Row { name: string; color: string | null }
export type TagRow = CategoryRow;
export interface DocumentRow extends Row {
  original_name: string; sha256: string; status: string; error: string | null; extracted: unknown;
  uploaded_at: string | null; has_file: boolean;
}
export interface ExpenseRow extends Row {
  date: string; amount_cents: number; description: string; provider: string | null; invoice_number: string | null;
  period_start: string | null; period_end: string | null; source: string; reviewed: boolean; notes: string | null;
  external_id: string | null; import_batch: string | null; created_at: string | null;
  category_id: number | null; document_id: number | null; tag_ids: number[];
}
export interface IncomeRow extends Row {
  date: string; amount_cents: number; description: string; kind: string; source: string; notes: string | null;
  external_id: string | null; import_batch: string | null; created_at: string | null;
}
export interface SettingRow extends Row { key: string; value: unknown }
export interface LogRow extends Row { at: string; user: string; action: string; summary: string; details: unknown[] }

type RowOf<K extends Kind> = K extends "category" | "tag" ? CategoryRow : K extends "document" ? DocumentRow
  : K extends "expense" ? ExpenseRow : K extends "income" ? IncomeRow : K extends "setting" ? SettingRow : LogRow;

export interface StoredRecord { id: string; kind: string; version: number; updated_by?: string | null; updated_at?: string; data: unknown }
export interface Op { op: "put" | "del"; kind: Kind; row: Row; data?: unknown; before?: Row }

/** Id numérico de un uuid: sus 13 primeras cifras hexadecimales (cabe exacto en un número de JavaScript). */
export const numericId = (uid: string) => parseInt(uid.replace(/-/g, "").slice(0, 13), 16);

const parseTime = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

export class Db {
  categories = new Map<number, CategoryRow>();
  tags = new Map<number, TagRow>();
  documents = new Map<number, DocumentRow>();
  expenses = new Map<number, ExpenseRow>();
  incomes = new Map<number, IncomeRow>();
  settingRows = new Map<number, SettingRow>();
  logs = new Map<number, LogRow>();
  pending: Op[] = [];
  private uids = new Map<number, string>();

  constructor(private idOf: (uid: string) => number = numericId, private newUid: () => string = () => crypto.randomUUID()) {}

  table<K extends Kind>(kind: K): Map<number, RowOf<K>> {
    const t = { category: this.categories, tag: this.tags, document: this.documents, expense: this.expenses,
      income: this.incomes, setting: this.settingRows, log: this.logs }[kind];
    return t as unknown as Map<number, RowOf<K>>;
  }

  private ref = (uid: unknown) => (typeof uid === "string" && uid ? this.idOf(uid) : null);
  private uidOf = (id: number | null) => (id == null ? null : this.uids.get(id) ?? null);

  /** Carga (o actualiza) registros descifrados. `seq` ordena lo creado a la vez; por defecto, la fecha de alta. */
  load(records: StoredRecord[], seqOf?: (r: StoredRecord) => number) {
    for (const r of records) {
      const kind = r.kind as Kind;
      const id = this.idOf(r.id);
      this.uids.set(id, r.id);
      const d = r.data as Record<string, unknown>;
      const base = { id, uid: r.id, version: r.version, updated_by: r.updated_by ?? null,
        seq: seqOf ? seqOf(r) : parseTime((d.created_at ?? d.uploaded_at ?? d.at ?? r.updated_at) as string) };
      let row: Row;
      if (kind === "expense") {
        row = { ...base, ...(d as object), category_id: this.ref(d.category_id), document_id: this.ref(d.document_id),
          tag_ids: ((d.tag_ids as string[]) ?? []).map((u) => this.idOf(u)), created_at: (d.created_at as string) ?? null } as ExpenseRow;
      } else {
        row = { ...base, ...(d as object) } as Row;
      }
      if (!this.table(kind)) continue; // tipo desconocido (de una versión más nueva): se ignora
      this.table(kind).set(id, row as never);
    }
  }

  forget(uid: string) {
    const id = this.idOf(uid);
    for (const k of ["category", "tag", "document", "expense", "income", "setting", "log"] as Kind[]) this.table(k).delete(id);
  }

  /** Datos que se guardan cifrados (sin los campos internos y con las referencias como uuid). */
  toData(kind: Kind, row: Row): unknown {
    const { id: _i, uid: _u, version: _v, seq: _s, updated_by: _b, ...rest } = row as Row & Record<string, unknown>;
    if (kind === "expense") {
      const e = rest as unknown as ExpenseRow;
      return { ...e, category_id: this.uidOf(e.category_id), document_id: this.uidOf(e.document_id),
        tag_ids: e.tag_ids.map((t) => this.uidOf(t)).filter(Boolean) };
    }
    return rest;
  }

  /** Fila nueva con su uuid e id. */
  create<K extends Kind>(kind: K, fields: Omit<RowOf<K>, keyof Row>): RowOf<K> {
    const uid = this.newUid();
    const id = this.idOf(uid);
    this.uids.set(id, uid);
    const row = { ...fields, id, uid, version: 0, seq: Date.now() } as RowOf<K>;
    this.save(kind, row);
    return row;
  }

  save<K extends Kind>(kind: K, row: RowOf<K>) {
    // Estado anterior (para la actividad): el de antes del primer cambio de esta petición; nada si es nuevo
    const earlier = this.pending.find((p) => p.row.id === row.id);
    const before = earlier ? earlier.before : row.version === 0 ? undefined : this.table(kind).get(row.id);
    this.table(kind).set(row.id, row);
    this.pending = this.pending.filter((p) => p.row.id !== row.id); // si cambia dos veces, se guarda una
    this.pending.push({ op: "put", kind, row, data: this.toData(kind, row), before });
  }

  remove<K extends Kind>(kind: K, row: RowOf<K>) {
    this.table(kind).delete(row.id);
    const wasNew = this.pending.some((p) => p.row.id === row.id && p.row.version === 0);
    this.pending = this.pending.filter((p) => p.row.id !== row.id);
    if (!wasNew) this.pending.push({ op: "del", kind, row });
  }

  takePending(): Op[] {
    const ops = this.pending;
    this.pending = [];
    return ops;
  }

  // ---------- ajustes (clave → valor) ----------
  setting<T>(key: string): T | undefined {
    let best: SettingRow | undefined;
    for (const s of this.settingRows.values()) if (s.key === key && (!best || s.version > best.version)) best = s;
    return best?.value as T | undefined;
  }

  setSetting(key: string, value: unknown) {
    const rows = [...this.settingRows.values()].filter((s) => s.key === key);
    const [keep, ...dupes] = rows; // dos usuarios a la vez pueden haber creado la misma clave: se deja una
    for (const d of dupes) this.remove("setting", d);
    if (keep) this.save("setting", { ...keep, value });
    else this.create("setting", { key, value });
  }
}
