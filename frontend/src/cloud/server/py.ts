/** Ayudas para que la lógica del navegador dé exactamente lo mismo que la de Python. */

/** Minúsculas y sin acentos (como fold() de Python: NFKD y fuera lo que no es ASCII). */
export const fold = (s: string) => s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();

/** round() de Python: redondeo al par en los empates. */
export function pyRound(x: number, digits = 0): number {
  const f = 10 ** digits;
  const v = x * f;
  const r = Math.round(v);
  const tie = Math.abs(v % 1) === 0.5;
  return (tie && r % 2 !== 0 ? r - 1 : r) / f;
}

/** statistics.median_low */
export function medianLow(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** statistics.median */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------- fechas "AAAA-MM-DD" ----------
const DAY = 86_400_000;

export function dayNum(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}

export function fromDay(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export const addDays = (iso: string, n: number) => fromDay(dayNum(iso) + n);
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a); // b - a
export const monthIdx = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
export const monthStr = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const year = (iso: string) => Number(iso.slice(0, 4));
export const month = (iso: string) => Number(iso.slice(5, 7));

/** "dd/mm/aaaa" */
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** "dd/mm" */
export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "1.234,56 €" como _money() de Python. */
export function money(cents: number): string {
  const [int, dec] = (cents / 100).toFixed(2).split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  return `${neg ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec} €`;
}

/** str.title() de Python para texto ASCII. */
export function title(s: string): string {
  return s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

export function groupBy<T, K>(items: T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of items) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}
