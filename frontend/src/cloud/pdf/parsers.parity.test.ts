/**
 * Lectores de facturas: con el mismo texto, el mismo resultado que Python (GASTOS_FIXTURES/pdfs.json; sin él se salta).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseText } from "./parsers";

const dir = process.env.GASTOS_FIXTURES;
const ready = Boolean(dir && existsSync(join(dir, "pdfs.json")));
interface Item { id: number; name: string; text: string; result: Record<string, unknown> }

describe.skipIf(!ready)("lectores de PDF igual que en Python (mismo texto)", () => {
  const items: Item[] = ready ? JSON.parse(readFileSync(join(dir!, "pdfs.json"), "utf-8")) : [];
  for (const item of items) {
    it(`${item.id} ${item.result.parser}`, () => {
      expect(parseText(item.text, item.name)).toEqual(item.result);
    });
  }
});
