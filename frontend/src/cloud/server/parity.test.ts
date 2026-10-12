/**
 * Equivalencia con el servidor de Python: con los mismos datos, cada ruta debe responder lo mismo.
 * Usa datos reales que NO están en el repositorio: GASTOS_FIXTURES=<carpeta con backup.json y responses.json>.
 * Sin esa variable la prueba se salta.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Server } from "./api";
import { Db, StoredRecord } from "./db";

const dir = process.env.GASTOS_FIXTURES;
const ready = Boolean(dir && existsSync(join(dir, "responses.json")));

interface Fixture { path: string; params: Record<string, string | number>; response: unknown }

function load() {
  const fixtures = JSON.parse(readFileSync(join(dir!, "responses.json"), "utf-8")) as Record<string, Fixture>;
  const backup = JSON.parse(readFileSync(join(dir!, "backup.json"), "utf-8"));
  const today = process.env.GASTOS_TODAY ?? new Date().toISOString().slice(0, 10);
  const catId = new Map((fixtures.categories.response as { id: number; name: string }[]).map((c) => [c.name, c.id]));
  const tagId = new Map((fixtures.tags.response as { id: number; name: string }[]).map((t) => [t.name, t.id]));
  const recs: StoredRecord[] = [];
  const add = (kind: string, id: number, data: unknown) => recs.push({ id: `${kind}-${id}`, kind, version: 1, data });
  for (const c of backup.categories) add("category", catId.get(c.name)!, c);
  for (const t of backup.tags) add("tag", tagId.get(t.name)!, t);
  for (const d of backup.documents) add("document", d.id, { ...d, has_file: true });
  for (const e of backup.expenses) {
    const { category, tags, ...rest } = e;
    add("expense", e.id, { ...rest, category_id: category ? `category-${catId.get(category)}` : null,
      document_id: e.document_id ? `document-${e.document_id}` : null, tag_ids: (tags as string[]).map((n) => `tag-${tagId.get(n)}`) });
  }
  for (const i of backup.incomes) add("income", i.id, i);
  let n = 0;
  for (const [key, value] of Object.entries(backup.settings ?? {})) add("setting", ++n, { key, value });
  const db = new Db((uid) => Number(uid.split("-").at(-1)));
  db.load(recs, (r) => Number(r.id.split("-").at(-1)));
  const server = new Server(db, { user: process.env.GASTOS_USER ?? "usuario", today: () => today, now: () => `${today}T00:00:00` });
  return { fixtures, server };
}

/** Compara permitiendo diferencias de redondeo en los importes. */
function same(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.006 ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: ${a.length} elementos ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = same(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

describe.skipIf(!ready)("equivalencia con el servidor de Python", () => {
  const { fixtures, server } = ready ? load() : ({} as ReturnType<typeof load>);
  for (const name of ready ? Object.keys(fixtures) : []) {
    it(name, async () => {
      const f = fixtures[name];
      const query = new URLSearchParams(Object.entries(f.params).map(([k, v]) => [k, String(v)]));
      const [, body] = await server.handle({ method: "GET", path: f.path, query, body: undefined });
      expect(same(JSON.parse(JSON.stringify(body)), f.response)).toBeNull();
    });
  }
});
