import { describe, expect, it } from "vitest";
import { describeChanges, HttpError, Server } from "./api";
import { exportBackup, importBackup } from "./backup";
import { Db } from "./db";

function setup() {
  let n = 0;
  const db = new Db(Number, () => String(++n));
  const files = new Map<string, Uint8Array>();
  const server = new Server(db, {
    user: "ana", today: () => "2026-10-12", now: () => "2026-10-12T10:00:00",
    files: { put: async (u, b) => { files.set(u, b); }, get: async (u) => files.get(u)!, del: async (u) => { files.delete(u); } },
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, "http://x");
    try {
      const [status, data] = await server.handle({ method, path: url.pathname, query: url.searchParams, body });
      return { status, data: data as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, data: { detail: err.message } as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      throw err;
    }
  };
  return { db, server, call, files };
}

const expense = (o: Record<string, unknown> = {}) => ({ date: "2026-10-01", amount: 12.5, description: "Mercadona", provider: null,
  invoice_number: null, period_start: null, period_end: null, category_id: null, notes: null, reviewed: true, ...o });

describe("servidor del navegador", () => {
  it("crea, edita y borra gastos y apunta los cambios", async () => {
    const { db, call } = setup();
    const cat = (await call("POST", "/api/categories", { name: "Supermercado", color: null })).data;
    const e = (await call("POST", "/api/expenses", expense({ category_id: cat.id, invoice_number: "N/A" }))).data;
    expect(e).toMatchObject({ amount: 12.5, category: "Supermercado", source: "manual", invoice_number: null, concept: "Mercadona" });
    const ops = db.takePending();
    expect(ops.map((o) => o.op)).toEqual(["put", "put"]);
    const created = describeChanges(db, ops, "POST", "/api/expenses", "ana", "x")!;
    expect(created.action).toBe("Nuevo gasto");
    expect(created.summary).toBe("1 alta de categoría · 1 alta de gasto");

    // Se guardó: ahora ya tiene versión
    for (const o of ops) db.table(o.kind).get(o.row.id)!.version = 1;
    await call("PUT", `/api/expenses/${e.id}`, expense({ amount: 13, category_id: cat.id }));
    const edit = describeChanges(db, db.takePending(), "PUT", `/api/expenses/${e.id}`, "ana", "x")!;
    expect(edit.details[0]).toMatchObject({ op: "cambio", changes: { importe: [12.5, 13] } });

    expect((await call("DELETE", `/api/expenses/${e.id}`)).status).toBe(204);
    expect((await call("GET", "/api/expenses")).data).toEqual([]);
  });

  it("al cambiar la categoría la copian los gastos iguales y se aprende para el banco", async () => {
    const { db, call } = setup();
    const otros = (await call("POST", "/api/categories", { name: "Otros", color: null })).data;
    const ocio = (await call("POST", "/api/categories", { name: "Ocio", color: null })).data;
    db.create("expense", { date: "2026-09-01", amount_cents: 900, description: "Cine Verdi", provider: null, invoice_number: null,
      period_start: null, period_end: null, source: "banco", reviewed: true, notes: null, external_id: "k1", import_batch: null,
      created_at: null, category_id: otros.id, document_id: null, tag_ids: [] });
    db.create("expense", { date: "2026-09-08", amount_cents: 900, description: "Cine Verdi", provider: null, invoice_number: null,
      period_start: null, period_end: null, source: "banco", reviewed: true, notes: null, external_id: "k2", import_batch: null,
      created_at: null, category_id: otros.id, document_id: null, tag_ids: [] });
    const [a, b] = [...db.expenses.values()];
    expect((await call("GET", `/api/expenses/${a.id}/similar`)).data).toEqual({ merchant: "cine", count: 1 });
    const res = (await call("PUT", `/api/expenses/${a.id}`, expense({ date: a.date, amount: 9, description: "Cine Verdi", category_id: ocio.id }))).data;
    expect(res.similar_updated).toBe(1);
    expect(db.expenses.get(b.id)!.category_id).toBe(ocio.id);
    expect(db.setting("bank_category_by_group")).toEqual({ cine: "Ocio" });
  });

  it("una etiqueta de tipo de coche sustituye a la otra", async () => {
    const { call } = setup();
    const gas = (await call("POST", "/api/tags", { name: "Gasolina", color: null })).data;
    const peaje = (await call("POST", "/api/tags", { name: "  Peajes ", color: null })).data;
    expect(peaje.name).toBe("Peajes");
    const e = (await call("POST", "/api/expenses", expense({ tag_ids: [gas.id] }))).data;
    expect((await call("POST", `/api/tags/${peaje.id}/apply`, { expense_ids: [e.id] })).data).toEqual({ changed: 1 });
    const after = (await call("GET", `/api/expenses/${e.id}`)).data;
    expect(after.tags.map((t: { name: string }) => t.name)).toEqual(["Peajes"]);
    expect((await call("GET", "/api/tags")).data.find((t: { name: string }) => t.name === "Peajes")).toMatchObject({ count: 1, total: 12.5 });
    expect((await call("POST", "/api/tags", { name: "Peajes", color: null })).status).toBe(409);
  });

  it("borrar una categoría deja sus gastos sin categoría", async () => {
    const { call } = setup();
    const cat = (await call("POST", "/api/categories", { name: "Luz", color: null })).data;
    const e = (await call("POST", "/api/expenses", expense({ category_id: cat.id }))).data;
    await call("DELETE", `/api/categories/${cat.id}`);
    expect((await call("GET", "/api/expenses?category_id=0")).data.map((x: { id: number }) => x.id)).toEqual([e.id]);
  });

  it("importa movimientos del banco una sola vez y se puede deshacer", async () => {
    const { db, call } = setup();
    const movements = [
      { key: "aaaaaaaa1", date: "2026-09-02", amount: 30, description: "Mercadona", category: "Supermercado", group: "mercadona", direction: "gasto" },
      { key: "aaaaaaaa2", date: "2026-09-28", amount: 900, description: "Traspaso", income_kind: "Aportaciones mensuales", direction: "ingreso" },
    ];
    const r = (await call("POST", "/api/bank/import", { movements, session: "s1", excluded_kinds: ["Bizum"] })).data;
    expect(r).toMatchObject({ imported: 2, skipped: 0 });
    expect(r.batch.startsWith("s1.")).toBe(true);
    expect((await call("POST", "/api/bank/import", { movements, session: "s1" })).data).toMatchObject({ imported: 0, skipped: 2 });
    expect([...db.categories.values()].map((c) => c.name)).toEqual(["Supermercado"]);
    expect(db.setting("bank_excluded_kinds")).toEqual(["Bizum"]);
    const imports = (await call("GET", "/api/bank/imports")).data;
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ count: 1, incomes: 1, total: 30, income_total: 900, session: "s1" });
    expect((await call("POST", "/api/bank/imports/undo", { batches: [r.batch] })).data).toEqual({ deleted: 2 });
    expect(db.expenses.size + db.incomes.size).toBe(0);
  });

  it("revisar: descartar y volver a mostrar avisos", async () => {
    const { call } = setup();
    await call("POST", "/api/expenses", expense({ reviewed: false }));
    await call("POST", "/api/expenses", expense({ amount: -3 }));
    const review = (await call("GET", "/api/review")).data;
    const raro = review.sections.find((s: { id: string }) => s.id === "raros").items[0];
    expect(raro.detail).toContain("importe 0 o negativo");
    await call("POST", "/api/review/dismiss", { keys: [raro.key] });
    const after = (await call("GET", "/api/review")).data;
    expect(after.total).toBe(review.total - 1);
    expect((await call("POST", "/api/review/restore", { keys: [] })).data).toEqual({ dismissed: 0 });
  });

  it("la copia de seguridad va y vuelve con PDF, etiquetas, ajustes y avisos descartados", async () => {
    const src = setup();
    const cat = (await src.call("POST", "/api/categories", { name: "Luz", color: "#fff" })).data;
    const tag = (await src.call("POST", "/api/tags", { name: "Casa", color: null })).data;
    const doc = src.db.create("document", { original_name: "f.pdf", sha256: "abc", status: "procesado", error: null, extracted: null,
      uploaded_at: "2026-01-01T00:00:00", has_file: true });
    src.files.set(doc.uid, new Uint8Array([37, 80, 68, 70]));
    const e = (await src.call("POST", "/api/expenses", expense({ category_id: cat.id, tag_ids: [tag.id], reviewed: false }))).data;
    src.db.save("expense", { ...src.db.expenses.get(e.id)!, document_id: doc.id });
    await src.call("POST", "/api/incomes", { date: "2026-10-01", amount: 100, description: "Aporte", kind: "Aportaciones mensuales" });
    await src.call("POST", "/api/review/dismiss", { keys: [`pend:${e.id}`, "nocontrib:2025-01"] });
    await src.call("PUT", "/api/prefs", { nav: ["/gastos", "/"] });
    const zip = new Uint8Array(await (await exportBackup(src.db, src.server.ctx, true)).arrayBuffer());

    const dst = setup();
    await dst.call("POST", "/api/categories", { name: "Vieja", color: null });
    const stats = await importBackup(dst.db, dst.server.ctx, zip, "replace");
    expect(stats).toEqual({ categorias: 1, documentos: 1, gastos: 1, gastos_omitidos: 0, ingresos: 1 });
    const [copy] = (await dst.call("GET", "/api/expenses")).data;
    expect(copy).toMatchObject({ category: "Luz", reviewed: false, tags: [{ name: "Casa" }] });
    expect(dst.files.get(dst.db.documents.get(copy.document_id)!.uid)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(dst.db.setting("review_dismissed")).toEqual([`pend:${copy.id}`, "nocontrib:2025-01"].sort());
    expect(dst.db.setting("prefs:ana")).toEqual({ nav: ["/gastos", "/"] });
    expect([...dst.db.categories.values()].map((c) => c.name)).toEqual(["Luz"]);
    // Añadir la misma copia otra vez no duplica nada
    expect(await importBackup(dst.db, dst.server.ctx, zip, "merge")).toMatchObject({ gastos: 0, gastos_omitidos: 1, ingresos: 0, documentos: 0 });
  });
});
