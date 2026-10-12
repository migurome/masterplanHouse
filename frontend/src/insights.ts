// Conclusiones sobre el gasto, calculadas con reglas a partir de los totales (sin servicios externos).
import { money } from "./format";

export type Totals = Map<number, number>; // año → importe
export interface Insight { kind: "nivel" | "principales" | "crece" | "baja" | "estable" | "fijos" | "conceptos" | "datos"; title: string; lines: string[] }

// Gastos que se repiten cada mes y cuestan parecido: el resto se considera variable
export const FIXED = new Set(["Alquiler", "Luz", "Gas", "Agua", "Internet", "Comunidad", "Calefacción", "Seguros", "Suscripciones"]);

const pctFmt = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
const shareFmt = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 });
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
export const pct = (from: number, to: number) => (from > 0 ? pctFmt.format((to - from) / from) : to > 0 ? "nuevo" : "—");
export const share = (n: number) => shareFmt.format(n);

function list(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

const get = (t: Totals | undefined, y: number) => t?.get(y) ?? 0;

export function buildInsights(opts: {
  years: number[];
  total: Totals;
  byCategory: Map<string, Totals>;
  byConcept: Map<string, { category: string; totals: Totals }>;
  months: number; // meses que cuenta cada año
  periodLabel: string; // "" o " (enero–octubre)"
}): Insight[] {
  const { years, total, byCategory, byConcept, months, periodLabel } = opts;
  if (years.length === 0) return [];
  const first = years[0];
  const last = years[years.length - 1];
  const prev = years.length > 1 ? years[years.length - 2] : null;
  const out: Insight[] = [];
  const T = (y: number) => get(total, y);

  // 1. Nivel de gasto
  const nivel = [`En ${last}${periodLabel} el gasto es de ${money(T(last))}: ${money(T(last) / months)} al mes de media.`];
  if (prev !== null) nivel.push(`Frente a ${prev}: ${signed(T(last) - T(prev))} (${pct(T(prev), T(last))}).`);
  if (years.length > 2) nivel.push(`Desde ${first}: de ${money(T(first))} a ${money(T(last))} (${pct(T(first), T(last))}).`);
  const peak = years.reduce((a, b) => (T(b) > T(a) ? b : a));
  if (years.length > 2) nivel.push(`El año con más gasto es ${peak} (${money(T(peak))}).`);
  out.push({ kind: "nivel", title: "Nivel de gasto", lines: nivel });

  // 2. Principales partidas del último año
  const ranked = [...byCategory.entries()].map(([c, t]) => [c, get(t, last)] as const).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const top = ranked.slice(0, 3);
    const topShare = top.reduce((s, [, v]) => s + v, 0) / (T(last) || 1);
    out.push({
      kind: "principales", title: `Principales partidas de ${last}`,
      lines: [
        `${list(top.map(([c, v]) => `${c} (${money(v)}, ${share(v / (T(last) || 1))})`))}: entre las tres, el ${share(topShare)} del gasto.`,
        ...(ranked[0] ? [`${ranked[0][0]} es la partida más grande: ${money(ranked[0][1] / months)} al mes.`] : []),
      ],
    });
  }

  if (years.length > 1) {
    // 3-5. Lo que crece, baja o se mantiene (del primer al último año elegido)
    const changes = [...byCategory.entries()].map(([c, t]) => ({ c, a: get(t, first), b: get(t, last) }))
      .filter((x) => x.a > 0 || x.b > 0);
    const grow = changes.filter((x) => x.b - x.a >= 50).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 4);
    const drop = changes.filter((x) => x.a - x.b >= 50).sort((x, y) => (x.b - x.a) - (y.b - y.a)).slice(0, 4);
    const stable = changes.filter((x) => Math.min(x.a, x.b) >= 150 && Math.abs(x.b - x.a) / x.a <= 0.1);
    const span = `de ${first} a ${last}`;
    if (grow.length) {
      out.push({
        kind: "crece", title: "Lo que más crece",
        lines: grow.map((x) => x.a === 0
          ? `${x.c}: partida nueva, ${money(x.b)} en ${last}.`
          : `${x.c}: ${signed(x.b - x.a)} ${span} (${pct(x.a, x.b)}), de ${money(x.a)} a ${money(x.b)}.`),
      });
    }
    if (drop.length) {
      out.push({
        kind: "baja", title: "Lo que baja",
        lines: drop.map((x) => `${x.c}: ${signed(x.b - x.a)} ${span} (${pct(x.a, x.b)}), de ${money(x.a)} a ${money(x.b)}.`),
      });
    }
    out.push({
      kind: "estable", title: "Lo que se mantiene",
      lines: stable.length
        ? [`${list(stable.map((x) => `${x.c} (${pct(x.a, x.b)})`))}: variación de menos del 10 % ${span}.`]
        : [`Ninguna partida importante se mantiene estable ${span} (todas varían más de un 10 %).`],
    });

    // 6. Fijos frente a variables
    const fixed = (y: number) => [...byCategory.entries()].filter(([c]) => FIXED.has(c)).reduce((s, [, t]) => s + get(t, y), 0);
    const fa = fixed(first), fb = fixed(last), va = T(first) - fa, vb = T(last) - fb;
    out.push({
      kind: "fijos", title: "Gastos fijos y variables",
      lines: [
        `Fijos (alquiler, suministros, seguros, suscripciones): ${money(fb)} en ${last}, el ${share(fb / (T(last) || 1))} del total (${pct(fa, fb)} desde ${first}).`,
        `Variables (compras, ocio, transporte, viajes…): ${money(vb)}, el ${share(vb / (T(last) || 1))} (${pct(va, vb)} desde ${first}).`,
        vb - va > fb - fa
          ? "El aumento del gasto viene sobre todo de los gastos variables: es donde hay más margen para ajustar."
          : "El aumento del gasto viene sobre todo de los gastos fijos.",
      ],
    });

    // 7. Conceptos que más crecen
    const conceptGrowth = [...byConcept.entries()].map(([k, v]) => ({ k, cat: v.category, a: get(v.totals, first), b: get(v.totals, last) }))
      .filter((x) => x.b - x.a >= 50).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 5);
    if (conceptGrowth.length) {
      out.push({
        kind: "conceptos", title: "Conceptos que más suben",
        lines: conceptGrowth.map((x) => `${x.k}${x.k === x.cat ? "" : ` (${x.cat})`}: ${signed(x.b - x.a)} ${span}${x.a > 0 ? ` (${pct(x.a, x.b)})` : ""}.`),
      });
    }
  }

  // 8. Avisos sobre los datos
  const gaps: string[] = [];
  for (const [c, t] of byCategory) {
    const withData = years.filter((y) => get(t, y) > 0);
    const empty = years.filter((y) => get(t, y) === 0);
    if (withData.length && empty.length && FIXED.has(c)) gaps.push(`${c} no tiene gastos en ${list(empty.map(String))}`);
  }
  if (gaps.length) {
    out.push({
      kind: "datos", title: "Ojo con los datos",
      lines: [`${gaps.join("; ")}: puede que falten facturas, así que esas comparaciones pueden exagerar las subidas.`],
    });
  }
  return out;
}
