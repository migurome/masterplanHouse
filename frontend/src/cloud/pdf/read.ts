/** Lectura de facturas en PDF en el navegador: texto con pdf.js y los mismos lectores que tenía el servidor. */
import type { PdfResult } from "../server/api";
import { parseText } from "./parsers";
import { pdfText } from "./text";

export async function readPdf(bytes: Uint8Array, name: string, _categories: string[], hint: string | null): Promise<PdfResult> {
  return parseText(await pdfText(bytes), name, hint);
}
