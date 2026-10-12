import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { Backup, BackupFormatError, ExpenseData, planMigration, readBackupZip } from "./migrate";

const backup: Backup = {
  format: "gastos-casa", version: 1, exported_at: "2026-10-11T10:00:00+00:00",
  categories: [{ name: "Luz", color: "#f00" }, { name: "Coche", color: null }],
  tags: [{ name: "Gasolina", color: null }],
  documents: [
    { id: 7, original_name: "factura.pdf", sha256: "abc", status: "procesado", error: null, extracted: {}, uploaded_at: null, file: "documentos/x.pdf" },
    { id: 8, original_name: "perdida.pdf", sha256: "def", status: "procesado", error: null, extracted: {}, uploaded_at: null, file: "documentos/y.pdf" },
  ],
  expenses: [
    { date: "2026-01-02", amount_cents: 3451, description: "Luz enero", provider: "Eléctrica", invoice_number: "F1", period_start: null,
      period_end: null, source: "pdf", reviewed: true, notes: null, external_id: null, import_batch: null, category: "Luz", document_id: 7, tags: [] },
    { date: "2026-01-05", amount_cents: 5000, description: "Gasolinera", provider: null, invoice_number: null, period_start: null,
      period_end: null, source: "banco", reviewed: false, notes: null, external_id: "h1", import_batch: "b1", category: "Coche", document_id: null, tags: ["Gasolina", "No existe"] },
  ],
  incomes: [{ date: "2026-01-01", amount_cents: 100000, description: "Aportación", kind: "Aportaciones", source: "banco", notes: null, external_id: "h2", import_batch: "b1" }],
};

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("migración desde la copia local", () => {
  it("convierte las referencias a los ids nuevos", () => {
    const plan = planMigration(backup, { "documentos/x.pdf": new Uint8Array([1, 2, 3]) }, ids());
    expect(plan.counts).toEqual({ category: 2, tag: 1, document: 2, expense: 2, income: 1 });
    const id = (kind: string, name: string) => plan.records.find((r) => r.kind === kind && (r.data as { name?: string }).name === name)!.id;
    const [luz, gasolina] = plan.records.filter((r) => r.kind === "expense").map((r) => r.data as ExpenseData);
    expect(luz.category_id).toBe(id("category", "Luz"));
    expect(luz.document_id).toBe(plan.files[0].id);
    expect(gasolina.category_id).toBe(id("category", "Coche"));
    expect(gasolina.tag_ids).toEqual([id("tag", "Gasolina")]); // la etiqueta que no existe se ignora
    expect(gasolina).toMatchObject({ amount_cents: 5000, external_id: "h1", reviewed: false });
    expect(plan.files).toHaveLength(1);
    expect(plan.missingFiles).toBe(1);
    expect(new Set(plan.records.map((r) => r.id)).size).toBe(plan.records.length);
  });

  it("lee el ZIP y rechaza otros archivos", () => {
    const zip = zipSync({ "backup.json": strToU8(JSON.stringify(backup)), "documentos/x.pdf": new Uint8Array([9]) });
    const { backup: b, files } = readBackupZip(zip);
    expect(b.expenses).toHaveLength(2);
    expect(files["documentos/x.pdf"]).toEqual(new Uint8Array([9]));
    expect(() => readBackupZip(new Uint8Array([1, 2, 3]))).toThrow(BackupFormatError);
    expect(() => readBackupZip(zipSync({ "otro.json": strToU8("{}") }))).toThrow(BackupFormatError);
  });
});
