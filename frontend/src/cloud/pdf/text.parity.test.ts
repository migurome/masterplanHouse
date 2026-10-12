/**
 * PDF leídos en el navegador (pdf.js): el resultado de los lectores debe ser el mismo que con el texto de PyMuPDF.
 * Usa los PDF reales (GASTOS_FIXTURES/pdfs/ y pdfs.json); sin ellos se salta.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseText } from "./parsers";
import { pdfText, setPdfJs } from "./text";

const dir = process.env.GASTOS_FIXTURES;
const ready = Boolean(dir && existsSync(join(dir, "pdfs.json")));
interface Item { id: number; name: string; text: string; result: Record<string, unknown> }

describe.skipIf(!ready)("PDF leídos con pdf.js igual que con PyMuPDF", () => {
  setPdfJs(() => import("pdfjs-dist/legacy/build/pdf.mjs") as never);
  const items: Item[] = ready ? JSON.parse(readFileSync(join(dir!, "pdfs.json"), "utf-8")) : [];
  for (const item of items) {
    it(`${item.id} ${item.result.parser}`, async () => {
      const text = await pdfText(new Uint8Array(readFileSync(join(dir!, "pdfs", `${item.id}.pdf`))));
      const got = parseText(text, item.name);
      if (process.env.GASTOS_DEBUG && JSON.stringify(got) !== JSON.stringify(item.result)) {
        console.log(`--- ${item.id}\nPYMUPDF:\n${item.text.slice(0, 1500)}\nPDFJS:\n${text.slice(0, 1500)}`);
      }
      expect(got).toEqual(item.result);
    });
  }
});
