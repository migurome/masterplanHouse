const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const eurShort = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export const money = (n: number) => eur.format(n);
export const moneyShort = (n: number) => eurShort.format(n);

export const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function date(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Paleta pastel validada: en este orden, cada color se distingue de su vecino también con
// daltonismo. Las series se apilan en este orden. Los pasteles sirven igual en modo oscuro.
export const PALETTE = ["#6fa3e0", "#f39a73", "#7cc4d4", "#e07f7f", "#f2cc6b", "#6cc39b", "#a596e6", "#9bc47a", "#e98fb6"];
const NEUTRAL = "#bdbab3";

export function seriesColor(color: string | null | undefined) {
  return (color || NEUTRAL).toLowerCase();
}

/** Posición de un color en la paleta (los que no están, al final). */
export function paletteSlot(color: string | null | undefined) {
  const i = PALETTE.indexOf((color || "").toLowerCase());
  return i < 0 ? PALETTE.length : i;
}
