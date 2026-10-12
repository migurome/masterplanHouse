/**
 * Lector mínimo de Excel (.xlsx) en el navegador: valores de las celdas de cada hoja, como openpyxl con
 * read_only=True y data_only=True (números, textos, fechas si la celda tiene formato de fecha).
 */
import { unzipSync } from "fflate";

export type Cell = XNum | string | boolean | ExcelDate | null;

/** Número de una celda; openpyxl lo da como int si el texto no tiene punto ni exponente y como float si lo tiene. */
export class XNum {
  constructor(public value: number, public isFloat: boolean) {}
}

/** Fecha de Excel (con hora si la tiene), como el datetime que da openpyxl. */
export class ExcelDate {
  constructor(public iso: string, public time: string | null) {}
}

export class XlsxError extends Error {}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code: string): boolean {
  const clean = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(clean) && !/^general$/i.test(clean) && !/[#0]/.test(clean.replace(/[dmyhs:/\-. ]/gi, ""));
}

function serialToDate(serial: number): ExcelDate {
  const ms = Math.round((serial - 25569) * 86_400_000); // 1900 (con el 29/02/1900 que no existió, como Excel)
  const d = new Date(ms);
  const iso = d.toISOString();
  const time = iso.slice(11, 19);
  return new ExcelDate(iso.slice(0, 10), time === "00:00:00" ? null : time);
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// XML sencillo con expresiones regulares: igual en el navegador y en las pruebas (sin DOMParser)
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]);
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}
/** Elementos <nombre ...>contenido</nombre> o <nombre .../> (con o sin prefijo de espacio de nombres). */
function* elements(text: string, name: string): Generator<{ attrs: Record<string, string>; inner: string }> {
  const re = new RegExp(String.raw`<(?:\w+:)?${name}\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?${name}>)`, "g");
  for (const m of text.matchAll(re)) yield { attrs: attrs(m[1]), inner: m[2] ?? "" };
}
/** Texto de un <si> o <is>: todos sus <t> (sin la fonética <rPh>). */
const richText = (inner: string) => [...elements(inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, ""), "t")]
  .map((t) => decode(t.inner)).join("");

export interface Sheet { name: string; rows: Cell[][] }

export function readXlsx(data: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new XlsxError("no es un Excel válido (.xlsx)");
  }
  if (!files["xl/workbook.xml"]) throw new XlsxError("no es un Excel válido (.xlsx)");

  const shared = files["xl/sharedStrings.xml"] ? [...elements(utf8(files["xl/sharedStrings.xml"]), "si")].map((si) => richText(si.inner)) : [];

  // Qué estilos son fechas
  const dateStyles = new Set<number>();
  if (files["xl/styles.xml"]) {
    const st = utf8(files["xl/styles.xml"]);
    const custom = new Map([...elements(st, "numFmt")].map((f) => [Number(f.attrs.numFmtId), f.attrs.formatCode ?? ""]));
    const cellXfs = [...elements(st, "cellXfs")][0];
    if (cellXfs) {
      [...elements(cellXfs.inner, "xf")].forEach((xf, i) => {
        const id = Number(xf.attrs.numFmtId ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
      });
    }
  }

  // Hojas en el orden del libro
  const rels = files["xl/_rels/workbook.xml.rels"] ? utf8(files["xl/_rels/workbook.xml.rels"]) : "";
  const target = new Map([...elements(rels, "Relationship")].map((r) => [r.attrs.Id, r.attrs.Target ?? ""]));
  const sheets = [...elements(utf8(files["xl/workbook.xml"]), "sheet")].map((s, i) => {
    let path = target.get(s.attrs["r:id"]) ?? `worksheets/sheet${i + 1}.xml`;
    path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
    return { name: s.attrs.name ?? `Hoja${i + 1}`, path };
  });

  return sheets.filter((s) => files[s.path]).map(({ name, path }) => {
    const rows: Cell[][] = [];
    for (const r of elements(utf8(files[path]), "row")) {
      const rowNum = Number(r.attrs.r ?? rows.length + 1);
      while (rows.length < rowNum - 1) rows.push([]); // filas vacías intermedias
      const row: Cell[] = [];
      for (const c of elements(r.inner, "c")) {
        const idx = c.attrs.r ? colIndex(c.attrs.r) : row.length;
        while (row.length < idx) row.push(null);
        const t = c.attrs.t;
        const vm = c.inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
        const v = vm ? decode(vm[1]) : null;
        let value: Cell = null;
        if (t === "s") value = v == null ? null : shared[Number(v)] ?? null;
        else if (t === "inlineStr") value = richText([...elements(c.inner, "is")][0]?.inner ?? "");
        else if (t === "str" || t === "e") value = v;
        else if (t === "b") value = v === "1";
        else if (v != null && v !== "") {
          value = dateStyles.has(Number(c.attrs.s ?? -1)) ? serialToDate(Number(v)) : new XNum(Number(v), /[.eE]/.test(v));
        }
        row[idx] = value;
      }
      rows.push(row);
    }
    return { name, rows };
  });
}

/** str() de Python para un valor de celda (para la huella del movimiento). */
export function pyStr(v: Cell): string {
  if (v === null || v === undefined) return "None";
  if (v instanceof ExcelDate) return v.time ? `${v.iso} ${v.time}` : `${v.iso} 00:00:00`;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v instanceof XNum) return v.isFloat ? pyFloatRepr(v.value) : String(v.value);
  return v;
}

/** repr() de un float de Python: como JavaScript pero los enteros llevan ".0". */
export function pyFloatRepr(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return `${n}.0`;
  const s = String(n);
  return s.includes("e") ? s.replace(/e([+-])(\d)$/, "e$10$2") : s;
}
