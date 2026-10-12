/**
 * Texto de un PDF en el navegador (pdf.js), ordenado en líneas como lo da PyMuPDF (page.get_text()), que es con lo
 * que se escribieron los lectores de facturas.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

interface Item { str: string; x: number; y: number; w: number; h: number; eol: boolean }

const GAP_NEW_LINE = 1; // hueco (en tamaños de letra) a partir del cual PyMuPDF empieza otra línea
const GAP_SPACE = 0.25; // hueco (en tamaños de letra) que PyMuPDF escribe como un espacio

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

/** pdf.js se carga solo cuando hace falta (es grande) y con su worker. */
export function setPdfJs(load: () => Promise<PdfJs>) {
  lib = load();
}

async function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist").then(async (m) => {
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    });
  }
  return lib;
}

/** Junta los trozos de texto de una página en líneas. */
export function linesOf(items: Item[]): string[] {
  const lines: string[] = [];
  let line = "";
  let last: Item | null = null;
  for (const it of items) {
    // pdf.js da los huecos entre columnas como un "espacio" muy ancho: es un cambio de línea para PyMuPDF
    if (it.str && !it.str.trim()) {
      if (it.w > it.h * GAP_NEW_LINE) {
        if (line) lines.push(line);
        line = "";
        last = null;
      } else if (line && !/\s$/.test(line)) {
        line += " ";
        last = it;
      }
      if (it.eol && line) { lines.push(line); line = ""; last = null; }
      continue;
    }
    if (last && line) {
      const size = Math.min(it.h, last.h);
      const gap = it.x - (last.x + last.w);
      const sameLine = Math.abs(it.y - last.y) < Math.max(1.5, size * 0.5);
      // Otra altura, o muy separado en la misma (etiqueta a un lado y valor al otro): PyMuPDF lo da en otra línea
      if (!sameLine || gap > size * GAP_NEW_LINE || gap < -size) {
        lines.push(line);
        line = "";
      } else {
        // PyMuPDF separa con un espacio las palabras que están separadas en la página
        if (gap > size * GAP_SPACE && !/\s$/.test(line) && !/^\s/.test(it.str)) line += " ";
      }
    }
    line += it.str;
    last = it;
    if (it.eol) {
      lines.push(line);
      line = "";
      last = null;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Diferencias de pdf.js con PyMuPDF en algunas facturas: glifos sin letra asignada (pdf.js da \0; es el guion) y
 * espacios que pdf.js añade dentro de fechas o asteriscos con interletrado ("05/ 07/ 2025", "* * *").
 */
export const tidy = (line: string) => line.replace(/\0/g, "-").replace(/(\d)\/ (?=\d)/g, "$1/").replace(/\* (?=\*)/g, "*");

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const m = await pdfjs();
  const pdf: PDFDocumentProxy = await m.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.hypot(it.transform[2], it.transform[3]) || it.height, eol: it.hasEOL });
      }
      pages.push(linesOf(items).map((l) => `${tidy(l)}\n`).join(""));
    }
  } finally {
    await pdf.destroy();
  }
  return pages.join("\n");
}
