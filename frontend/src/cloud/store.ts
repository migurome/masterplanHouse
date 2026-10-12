/** Datos en Supabase: todo se cifra aquí antes de salir y se descifra al llegar. */
import { decryptFile, decryptRecord, encryptFile, encryptRecord } from "../vault/crypto";
import { BUCKET, supabase } from "./client";

export type Kind = "category" | "tag" | "expense" | "income" | "document" | "setting";

export interface CloudRecord<T = Record<string, unknown>> {
  id: string;
  kind: Kind;
  version: number;
  updated_at: string;
  updated_by: string | null;
  data: T;
}

export interface NewRecord { id: string; kind: Kind; data: unknown }

const PAGE = 1000; // máximo de filas por petición de la API

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function countRecords(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let from = 0; ; from += PAGE) {
    const rows = check(await supabase.from("records").select("kind").range(from, from + PAGE - 1)) as { kind: string }[];
    for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1;
    if (rows.length < PAGE) return out;
  }
}

/** Descarga y descifra todos los registros (o los de un tipo). */
export async function loadRecords(key: CryptoKey, kind?: Kind): Promise<CloudRecord[]> {
  const out: CloudRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("records").select("id, kind, data, version, updated_at, updated_by").order("id");
    if (kind) q = q.eq("kind", kind);
    const rows = check(await q.range(from, from + PAGE - 1)) as (Omit<CloudRecord, "data"> & { data: string })[];
    for (const r of rows) out.push({ ...r, data: await decryptRecord(key, "records", r.id, r.data) });
    if (rows.length < PAGE) return out;
  }
}

/** Cifra y guarda registros nuevos por tandas. */
export async function insertRecords(key: CryptoKey, records: NewRecord[], onProgress?: (done: number) => void) {
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    const rows = await Promise.all(records.slice(i, i + BATCH).map(async (r) => ({
      id: r.id, kind: r.kind, data: await encryptRecord(key, "records", r.id, r.data),
    })));
    check(await supabase.from("records").insert(rows));
    onProgress?.(Math.min(i + BATCH, records.length));
  }
}

/** Sube un PDF cifrado (el nombre en el almacén es solo el id: no revela nada). */
export async function uploadFile(key: CryptoKey, id: string, bytes: Uint8Array) {
  const sealed = await encryptFile(key, id, bytes);
  check(await supabase.storage.from(BUCKET).upload(id, new Blob([sealed]), {
    contentType: "application/octet-stream", upsert: false,
  }));
}

export async function downloadFile(key: CryptoKey, id: string): Promise<Uint8Array> {
  const blob = check(await supabase.storage.from(BUCKET).download(id)) as Blob;
  return decryptFile(key, id, new Uint8Array(await blob.arrayBuffer()));
}

/** Borra TODOS los datos de la nube (registros y PDF). La actividad queda. */
export async function wipeCloud() {
  for (;;) {
    const files = check(await supabase.storage.from(BUCKET).list("", { limit: 100 })) as { name: string }[];
    if (!files.length) break;
    check(await supabase.storage.from(BUCKET).remove(files.map((f) => f.name)));
  }
  check(await supabase.from("records").delete().not("id", "is", null));
}

export interface ActivityRow { id: number; at: string; user_id: string | null; op: string; tbl: string; kind: string | null; row_id: string | null }

export async function recentActivity(limit = 20): Promise<ActivityRow[]> {
  return check(await supabase.from("activity").select("*").order("id", { ascending: false }).limit(limit)) as ActivityRow[];
}
