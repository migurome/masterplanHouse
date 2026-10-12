// @vitest-environment happy-dom
/**
 * Excel del banco: el navegador debe dar lo mismo que Python (huellas, tipos, categorías y cotejo).
 * Usa los Excel reales (GASTOS_INBOX) y las respuestas de Python (GASTOS_FIXTURES/bank.json); sin ellos se salta.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Server } from "./api";
import { Db, StoredRecord } from "./db";

const dir = process.env.GASTOS_FIXTURES;
const inbox = process.env.GASTOS_INBOX;
const ready = Boolean(dir && inbox && existsSync(join(dir, "bank.json")));

function server() {
  const fixtures = JSON.parse(readFileSync(join(dir!, "responses.json"), "utf-8"));
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
  return new Server(db, { user: process.env.GASTOS_USER ?? "usuario", today: () => today, now: () => `${today}T00:00:00` });
}

describe.skipIf(!ready)("Excel del banco igual que en Python", () => {
  const expected = ready ? JSON.parse(readFileSync(join(dir!, "bank.json"), "utf-8")) : {};
  for (const name of Object.keys(expected)) {
    it(name, async () => {
      const names = name === "__todos__" ? Object.keys(expected).filter((n) => n !== "__todos__").sort() : [name];
      const form = new FormData();
      for (const n of names) form.append("files", new File([readFileSync(join(inbox!, n))], n));
      const [, got] = await server().handle({ method: "POST", path: "/api/bank/preview", query: new URLSearchParams(), body: form });
      const g = JSON.parse(JSON.stringify(got));
      const e = expected[name];
      expect(g.movements.length).toBe(e.movements.length);
      expect(g.movements.map((m: { key: string }) => m.key)).toEqual(e.movements.map((m: { key: string }) => m.key));
      expect(g).toEqual(e);
    });
  }
});
