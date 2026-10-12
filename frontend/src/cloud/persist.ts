/** Guarda en Supabase (cifrados) los cambios del servidor del navegador y trae los del otro usuario. */
import { decryptRecord, encryptRecord } from "../vault/crypto";
import { BUCKET, supabase } from "./client";
import type { Db, Op, StoredRecord } from "./server/db";
import { downloadFile, uploadFile } from "./store";

export class ConflictError extends Error {}

const BATCH = 200;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

type Row = { id: string; kind: string; data: string; version: number; updated_at: string; updated_by: string | null };

async function decryptRows(key: CryptoKey, rows: Row[]): Promise<StoredRecord[]> {
  return Promise.all(rows.map(async (r) => ({ ...r, data: await decryptRecord(key, "records", r.id, r.data) })));
}

/** Todos los registros, descifrados. */
export async function fetchAll(key: CryptoKey): Promise<StoredRecord[]> {
  const out: StoredRecord[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await supabase.from("records").select("id, kind, data, version, updated_at, updated_by")
      .order("id").range(from, from + 999)) as Row[];
    out.push(...await decryptRows(key, rows));
    if (rows.length < 1000) return out;
  }
}

async function fetchSome(key: CryptoKey, uids: string[]): Promise<StoredRecord[]> {
  const out: StoredRecord[] = [];
  for (let i = 0; i < uids.length; i += BATCH) {
    const rows = check(await supabase.from("records").select("id, kind, data, version, updated_at, updated_by")
      .in("id", uids.slice(i, i + BATCH))) as Row[];
    out.push(...await decryptRows(key, rows));
  }
  return out;
}

/** Guarda los cambios pendientes. Si otro usuario cambió lo mismo a la vez, trae su versión y avisa. */
export async function persist(key: CryptoKey, db: Db, ops: Op[]) {
  const inserts = ops.filter((o) => o.op === "put" && o.row.version === 0);
  const updates = ops.filter((o) => o.op === "put" && o.row.version > 0);
  const deletes = ops.filter((o) => o.op === "del");
  const setVersion = (o: Op, v: number) => {
    const live = db.table(o.kind).get(o.row.id);
    if (live) live.version = v;
    o.row.version = v;
  };

  for (let i = 0; i < inserts.length; i += BATCH) {
    const chunk = inserts.slice(i, i + BATCH);
    const rows = await Promise.all(chunk.map(async (o) => ({ id: o.row.uid, kind: o.kind, data: await encryptRecord(key, "records", o.row.uid, o.data) })));
    check(await supabase.from("records").insert(rows));
    chunk.forEach((o) => setVersion(o, 1));
  }

  const conflicts: string[] = [];
  await pool(updates, 8, async (o) => {
    const data = await encryptRecord(key, "records", o.row.uid, o.data);
    const res = check(await supabase.from("records").update({ data }).eq("id", o.row.uid).eq("version", o.row.version)
      .select("version")) as { version: number }[];
    if (res.length) setVersion(o, res[0].version);
    else conflicts.push(o.row.uid);
  });

  for (let i = 0; i < deletes.length; i += BATCH) {
    check(await supabase.from("records").delete().in("id", deletes.slice(i, i + BATCH).map((o) => o.row.uid)));
  }

  if (conflicts.length) {
    await refresh(key, db, conflicts);
    throw new ConflictError("Otra persona acaba de cambiar lo mismo. Se ha cargado su versión: revisa y vuelve a intentarlo.");
  }
}

/** Vuelve a traer unos registros (o los olvida si ya no existen). */
export async function refresh(key: CryptoKey, db: Db, uids: string[]) {
  const found = await fetchSome(key, uids);
  const seen = new Set(found.map((r) => r.id));
  for (const uid of uids) if (!seen.has(uid)) db.forget(uid);
  db.load(found);
}

/** Último movimiento conocido de la actividad (para traer después solo lo nuevo). */
export async function lastActivityId(): Promise<number> {
  const rows = check(await supabase.from("activity").select("id").order("id", { ascending: false }).limit(1)) as { id: number }[];
  return rows[0]?.id ?? 0;
}

/** Trae lo que ha cambiado desde `since`. Devuelve el nuevo punto y cuántos cambios eran de otra persona. */
export async function pullChanges(key: CryptoKey, db: Db, since: number, me: string): Promise<{ last: number; others: number }> {
  const rows = check(await supabase.from("activity").select("id, user_id, op, tbl, row_id").gt("id", since)
    .eq("tbl", "records").order("id").limit(5000)) as { id: number; user_id: string | null; op: string; row_id: string }[];
  if (!rows.length) return { last: since, others: 0 };
  const others = rows.filter((r) => r.user_id !== me);
  const uids = [...new Set(others.map((r) => r.row_id))];
  if (uids.length) await refresh(key, db, uids);
  return { last: rows.at(-1)!.id, others: uids.length };
}

export const files = (key: CryptoKey) => ({
  put: (uid: string, bytes: Uint8Array) => uploadFile(key, uid, bytes),
  get: (uid: string) => downloadFile(key, uid),
  del: async (uid: string) => { await supabase.storage.from(BUCKET).remove([uid]); },
});
