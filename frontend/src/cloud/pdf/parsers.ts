/**
 * Lectores de facturas (igual que backend/app/parsers): cada uno reconoce un formato (detect) y saca sus datos (parse).
 * Se prueban en orden y, si ninguno lo reconoce, el genérico intenta sacar al menos el total y una fecha.
 * Para añadir un proveedor nuevo: un objeto con name, detect y parse, en PARSERS antes de los más genéricos.
 */
import { parseAmount, parseDate } from "../server/bank";
import { fold, pyRound } from "../server/py";
import type { PdfResult } from "../server/api";

// Importes: "1.234,56" · "34,51" · "21.78" · "**********56,82" (nunca parte de una fecha)
const AMOUNT = String.raw`(?<![\d.,])(?:-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})(?![\d.,])`;
const NUM_DATE = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`;
const TEXT_DATE = String.raw`\d{1,2}(?: de)? [A-Za-zé]+(?: de)? \d{4}`;
const EN_DATE = String.raw`[A-Z][a-z]+ \d{1,2}, \d{4}`;
const ANY_DATE = `(?:${NUM_DATE}|${TEXT_DATE}|${EN_DATE})`;
const DOT_DATE = String.raw`\d{2}\.\d{2}\.\d{4}`;

/** Expresión de Python en JavaScript: \w de Python también acepta letras con acento. */
const rx = (pattern: string, flags = "") => new RegExp(pattern.replace(/\\w/g, String.raw`[\p{L}\p{N}_]`), flags.includes("u") ? flags : flags + "u");
/** str.title() de Python */
const title = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
const splitLines = (t: string) => t.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);

export class Doc {
  lines: string[];
  flat: string;
  low: string;
  constructor(public text: string, public filename = "", public hint: string | null = null) {
    this.lines = splitLines(text).map((l) => l.trim()).filter(Boolean);
    this.flat = text.replace(/\s+/g, " ");
    this.low = fold(this.flat);
  }
  has(...needles: string[]) { return needles.some((n) => this.low.includes(fold(n))); }
  find(pattern: string, group = 1, flags = "i"): string | null {
    const m = rx(pattern, flags).exec(this.flat);
    return m && m[group] != null ? m[group].trim() : null;
  }
  findall(pattern: string, flags = "i"): string[] {
    return [...this.flat.matchAll(rx(pattern, flags + "g"))].map((m) => (m.length > 1 ? m[1] : m[0]));
  }
  /** Primer `value` en la línea de `label` (tras la etiqueta) o en las `within` siguientes. */
  after(label: string, value: string, within = 4): string | null {
    const lre = rx(label, "i"), vre = rx(value);
    for (let i = 0; i < this.lines.length; i++) {
      const m = lre.exec(this.lines[i]);
      if (!m) continue;
      const rest = [this.lines[i].slice(m.index + m[0].length), ...this.lines.slice(i + 1, i + 1 + within)];
      for (const chunk of rest) {
        const v = vre.exec(chunk);
        if (v) return v[0];
      }
    }
    return null;
  }
  amountAfter(label: string, within = 4) { return parseAmount(this.after(label, AMOUNT, within)); }
  dateAfter(label: string, within = 4) { return parseDate(this.after(label, ANY_DATE, within)); }
  period(label = "Periodo|Período", within = 3): [string | null, string | null] {
    const pat = String.raw`(${ANY_DATE})\s*(?:a|al|-|hasta)\s*(${ANY_DATE})`;
    const raw = this.after(label, pat, within);
    if (!raw) return [null, null];
    const m = rx(`^${pat}`).exec(raw)!;
    return [parseDate(m[1]), parseDate(m[2])];
  }
}

export interface Parsed {
  provider: string; category: string; total: number | null; invoice_number: string | null; issue_date: string | null;
  charge_date: string | null; period_start: string | null; period_end: string | null; description: string;
  is_invoice: boolean; confidence: string; notes: string[];
}
const parsed = (p: Partial<Parsed> & Pick<Parsed, "provider" | "category">): Parsed => ({
  total: null, invoice_number: null, issue_date: null, charge_date: null, period_start: null, period_end: null,
  description: "", is_invoice: true, confidence: "alta", notes: [], ...p,
});

interface Parser { name: string; detect(d: Doc): boolean; parse(d: Doc): Parsed }
const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

// ---------- suministros ----------
const Octopus: Parser = {
  name: "Octopus Energy",
  detect: (d) => d.has("octopusenergy.es"),
  parse(d) {
    const [start, end] = d.period("^Periodo:");
    return parsed({ provider: this.name, category: "Luz", total: d.amountAfter("Total a pagar"),
      invoice_number: d.find(String.raw`N[úu]m\. Factura:\s*(\S+)`), issue_date: d.dateAfter("Fecha de emisi[óo]n:"),
      charge_date: d.dateAfter("Fecha de cargo:"), period_start: start, period_end: end,
      description: "Luz" + (d.has("Regularizadora") ? " (regularización)" : "") });
  },
};

const Iberdrola: Parser = {
  name: "Iberdrola",
  detect: (d) => d.has("IBERDROLA CLIENTES"),
  parse(d) {
    const gas = d.has("FACTURA DE GAS", "Impuesto sobre gas natural", "TARIFA PEAJE RL");
    const [start, end] = d.period("PERIODO DE FACTURACI[ÓO]N|Periodo de facturaci[óo]n");
    return parsed({ provider: this.name, category: gas ? "Gas" : "Luz",
      total: d.amountAfter("TOTAL IMPORTE FACTURA|TOTAL A PAGAR|^TOTAL$", 2),
      invoice_number: d.after("N[ºo] FACTURA:|N[úu]mero de factura", String.raw`\d{12,}`),
      issue_date: d.dateAfter("FECHA DE EMISI[ÓO]N|Fecha de emisi[óo]n de factura"),
      charge_date: d.dateAfter("FECHA PREVISTA DE COBRO|Fecha prevista de cargo"),
      period_start: start, period_end: end, description: gas ? "Gas" : "Luz" });
  },
};

const TotalEnergies: Parser = {
  name: "TotalEnergies",
  detect: (d) => d.has("TotalEnergies") && d.has("Factura n"),
  parse(d) {
    const [start, end] = d.period("Per[íi]odo facturaci[óo]n(?: elec\\.)?:");
    const issue = d.dateAfter("Fecha emisi[óo]n:");
    const total = d.amountAfter("Cu[áa]nto tengo que pagar", 3);
    // La fecha de cargo es la primera fecha dd.mm.aaaa posterior a la emisión
    const later = d.findall(String.raw`\b(\d{2}\.\d{2}\.\d{4})\b`).map(parseDate)
      .filter((x): x is string => Boolean(x && issue && x > issue)).sort();
    return parsed({ provider: this.name, category: "Luz", total, invoice_number: d.find(String.raw`Factura n[ºo°]\s*(\w+)`),
      issue_date: issue, charge_date: later[0] ?? null, period_start: start, period_end: end, description: "Luz" });
  },
};

const ASEnergia: Parser = {
  name: "AS Energía",
  detect: (d) => d.has("ALQUILER SEGURO ENERG", "asenergy.es", "asenery.es"),
  parse(d) {
    const gas = d.has("EGAS") || d.has("factura de gas");
    const number = d.find(String.raw`N[úu]mero de factura:\s*(E(?:GAS|ELEC) ?\d+)`);
    const [start, end] = d.period("^De |del$|Tu factura de gas del");
    const total = d.amountAfter("N[úu]mero de factura:\\s*E", 2) || d.amountAfter("TOTAL IMPORTE FACTURA", 1);
    let issue = d.dateAfter("Fecha (?:Emisi[óo]n|Factura):", 0);
    let charge = d.dateAfter("Fecha (?:de )?[Cc]obro:", 0);
    if (!issue || !charge) { // en el gas, las dos fechas van juntas antes de "Fecha Factura:"
      const m = rx(String.raw`(${NUM_DATE})\s+(${NUM_DATE})\s+Fecha Factura`).exec(d.flat);
      if (m) {
        const a = parseDate(m[1])!, b = parseDate(m[2])!;
        issue = issue || minDate(a, b);
        charge = charge || maxDate(a, b); // se emite antes de cobrarse
      }
    }
    return parsed({ provider: this.name, category: gas ? "Gas" : "Luz", total, invoice_number: number, issue_date: issue,
      charge_date: charge, period_start: start, period_end: end, description: gas ? "Gas" : "Luz" });
  },
};

const Curenergia: Parser = {
  name: "Curenergía",
  detect: (d) => d.has("CURENERG"),
  parse(d) {
    const [start, end] = d.period("Periodo de consumo:");
    return parsed({ provider: this.name, category: "Luz", total: parseAmount(d.find(String.raw`IMPORTE FACTURA:\s*(${AMOUNT})`)),
      invoice_number: d.find(String.raw`N[ºo] Factura:\s*(\d+)`), issue_date: parseDate(d.find(`emitida el (${ANY_DATE})`)),
      charge_date: d.dateAfter("Fecha de cargo:", 0), period_start: start, period_end: end, description: "Luz" });
  },
};

const Digi: Parser = {
  name: "DIGI",
  detect: (d) => d.has("digimobil.es") || (d.has("DIGI Spain") && d.has("DGFC")),
  parse(d) {
    const [start, end] = d.period("Periodo de consumo");
    return parsed({ provider: this.name, category: "Internet",
      // El importe va ANTES de cada etiqueta: se usa el resumen "Total a pagar (Impuestos incluidos): 31,89 €"
      total: parseAmount(d.find(String.raw`Total a pagar \(Impuestos incluidos\):\s*(${AMOUNT})`))
        || parseAmount(d.find(String.raw`(${AMOUNT})\s*€?\s*TOTAL A PAGAR`))
        || parseAmount(d.find(String.raw`(${AMOUNT})\s*€?\s*TOTAL FACTURA`)),
      invoice_number: d.find(String.raw`(DGFC\d+)`), issue_date: d.dateAfter("Fecha de emisi[óo]n"),
      charge_date: d.dateAfter("Fecha de vencimiento"), period_start: start, period_end: end, description: "Internet (fibra)" });
  },
};

const BankDirectDebit: Parser = {
  name: "Recibo bancario",
  detect: (d) => d.has("Detalle de movimiento", "CARGO POR ADEUDO DIRECTO"),
  parse(d) {
    let total: number | null, charge: string | null, issuer: string, number: string | null;
    if (d.has("Detalle de movimiento")) {
      total = d.amountAfter("Importe cargo", 1);
      if (total === null) { // otro formato: solo el saldo del movimiento (negativo)
        const saldo = d.amountAfter("Saldo Movimiento", 1);
        total = saldo !== null ? Math.abs(saldo) : null;
      }
      charge = d.dateAfter("Fecha cargo", 1) || d.dateAfter("Fecha Movimiento", 1);
      issuer = d.after("^Emisora$", ".+", 1) || "Recibo";
      number = d.find(String.raw`(?:ADEUDO N[ºo°]|Concepto N)\s*(\d{10,})`);
    } else { // justificante de cargo por adeudo directo (otro banco)
      total = parseAmount(d.find(String.raw`\*{3,}(\d+,\d{2})`));
      charge = parseDate(d.find(String.raw`VENCIMIENTO:.*?(\d{2}-\d{2}-\d{4})`) || d.find(String.raw`(\d{2}-\d{2}-\d{4})`));
      issuer = "Recibo domiciliado";
      number = d.find(String.raw`(20\d{14})`);
    }
    const concept = fold(d.find("Concepto:?\\s*(.{0,60})") || "");
    const category = concept.includes("agua") || fold(d.filename).includes("agua") ? "Agua" : d.hint ? d.hint : "Comunidad";
    return parsed({ provider: issuer, category, total, invoice_number: number, issue_date: charge, charge_date: charge,
      description: `${category} (recibo)`, confidence: d.hint || category === "Agua" ? "alta" : "media" });
  },
};

// ---------- compras ----------
const Mercadona: Parser = {
  name: "Mercadona",
  detect: (d) => d.has("MERCADONA, S.A."),
  parse(d) {
    const day = parseDate(d.find(String.raw`(${NUM_DATE}) \d{2}:\d{2} OP:`));
    return parsed({ provider: this.name, category: "Supermercado", total: parseAmount(d.find(String.raw`TOTAL \(€\)\s*(${AMOUNT})`)),
      invoice_number: d.find(String.raw`FACTURA SIMPLIFICADA:\s*([\d-]+)`), issue_date: day, charge_date: day, description: "Compra supermercado" });
  },
};

const FreeNow: Parser = {
  name: "FreeNow (taxi)",
  detect: (d) => d.has("mytaxi Iberia", "FREE NOW"),
  parse(d) {
    const day = parseDate(d.find(String.raw`Madrid, (\d{2}/\d{2}/\d{2,4})`) || d.find(`(${NUM_DATE})`));
    return parsed({ provider: this.name, category: "Transporte", total: parseAmount(d.find(String.raw`Importe total\s*(${AMOUNT})`)),
      invoice_number: d.find(String.raw`N[úu]mero de factura:\s*([\d-]+)`), issue_date: day, charge_date: day, description: "Taxi" });
  },
};

const Voltio: Parser = {
  name: "Voltio (motosharing)",
  detect: (d) => d.has("voltio.com", "MUTUAMAD SHARING"),
  parse(d) {
    const day = parseDate(d.find(`Fecha (${NUM_DATE})`));
    return parsed({ provider: this.name, category: "Transporte", total: parseAmount(d.find(String.raw`Total factura\s*(${AMOUNT})`)),
      invoice_number: d.find(String.raw`FACTURA SIMPLIFICADA (\d+)`), issue_date: day, charge_date: day, description: "Moto eléctrica compartida" });
  },
};

const Anthropic: Parser = {
  name: "Anthropic",
  detect: (d) => d.has("Anthropic, PBC"),
  parse(d) {
    const day = parseDate(d.find(`paid on (${EN_DATE})`) || d.find(`Date paid (${EN_DATE})`));
    return parsed({ provider: this.name, category: "Suscripciones", total: parseAmount(d.find(String.raw`€(\d+\.\d{2}) paid on`)),
      invoice_number: d.find(String.raw`Invoice number\s*(\S+)`), issue_date: day, charge_date: day,
      description: d.find(String.raw`(Claude \w+)`) || "Suscripción" });
  },
};

// ---------- viajes ----------
interface Ticket { ticket: string; price: number | null; day: string | null; loc: string | null; bought?: string | null; route?: string }

/** Billetes de Iryo/Ouigo: Iryo pone la fecha antes del número de billete; Ouigo, después. */
function tickets(d: Doc, ticketRe: string, dateBefore: boolean): Ticket[] {
  const joined = d.lines.join("|");
  const out = new Map<string, Ticket>();
  for (const m of joined.matchAll(rx(String.raw`\|(${ticketRe})\|`, "g"))) {
    const end = m.index! + m[0].length;
    const after = joined.slice(end, end + 160), before = joined.slice(Math.max(0, m.index! - 90), m.index!) + "|";
    const price = rx(String.raw`EUR ?(\d+[.,]\d{2})`).exec(after);
    let day: string | null;
    if (dateBefore) day = [...before.matchAll(rx(DOT_DATE, "g"))].map((x) => x[0]).at(-1) ?? null;
    else day = rx(DOT_DATE).exec(after.slice(0, 90))?.[0] ?? null;
    const loc = [...before.matchAll(rx(String.raw`\|([A-Z0-9]{6})(?=\|)`, "g"))].map((x) => x[1]);
    if (price && !out.has(m[1])) out.set(m[1], { ticket: m[1], price: parseAmount(price[1]), day: parseDate(day), loc: loc.at(-1) ?? null });
  }
  return [...out.values()];
}

function renfeTickets(d: Doc): Ticket[] {
  const pat = String.raw`(\d{2}/\d{2}/\d{4}) - \d{2}:\d{2}.*?Localizador: (\w+).*?TOTAL ([\d.,]+) €.*?` +
    String.raw`N[ºo°] Billete: (\d+).*?(\d{2}/\d{2}/\d{4}) \d{2}/\d{2}/\d{4} Origen: (.+?) Destino: ` +
    String.raw`(.+?) (?=ESTANDAR|TURISTA|B[AÁ]SIC|AVLO|AVE|ALVIA|AVANT|PREFERENTE|CONFORT|\d{2}:\d{2})`;
  const out = new Map<string, Ticket>();
  for (const m of d.flat.matchAll(rx(pat, "g"))) {
    if (!out.has(m[4])) out.set(m[4], { ticket: m[4], price: parseAmount(m[3]), day: parseDate(m[5]), loc: m[2],
      bought: parseDate(m[1]), route: `${title(m[6].trim())} → ${title(m[7].trim())}` });
  }
  return [...out.values()];
}

function operators(d: Doc): [string, Ticket[]][] {
  const ops: [string, Ticket[]][] = [];
  if (d.has("RENFE VIAJEROS") && rx(String.raw`Localizador: \w`).test(d.flat)) ops.push(["Renfe", renfeTickets(d)]); // Iryo también nombra a Renfe
  if (d.has("iryo.eu")) ops.push(["Iryo", tickets(d, String.raw`\d{13}`, true)]);
  if (d.has("OUIGO", "ouigo.com")) ops.push(["Ouigo", tickets(d, String.raw`\d{12}`, false)]);
  return ops;
}

const Train: Parser = {
  name: "Tren",
  detect: (d) => operators(d).length > 0,
  parse(d) {
    const ops = operators(d).filter(([, v]) => v.length);
    const all = ops.flatMap(([, v]) => v);
    if (!all.length) return parsed({ provider: "Tren", category: "Viajes", confidence: "baja", notes: ["No se reconocen los billetes: revisa importe y fecha"] });
    const days = all.map((t) => t.day).filter((x): x is string => Boolean(x)).sort();
    const names = ops.map(([k]) => k).join(" + ");
    const first = all[0], n = all.length;
    const route = all.find((t) => t.route)?.route ?? null;
    const bought = all.find((t) => t.bought)?.bought ?? null;
    return parsed({ provider: names, category: "Viajes", total: pyRound(all.reduce((s, t) => s + (t.price ?? 0), 0), 2),
      // Localizador + primer billete: un cambio de billete con el mismo localizador no es una copia
      invoice_number: `${first.loc || "?"}/${first.ticket}`, issue_date: bought || days[0] || null, charge_date: bought,
      period_start: days[0] ?? null, period_end: days.at(-1) ?? null,
      description: `Tren ${names}${route ? " " + route : ""} (${n} billete${n !== 1 ? "s" : ""})` });
  },
};

const AirChina: Parser = {
  name: "Air China",
  detect: (d) => d.has("Air China"),
  parse(d) {
    const amounts = d.findall(`(${AMOUNT}) EUR`).map(parseAmount).filter((x): x is number => x !== null);
    const flight = d.find(String.raw`(?:lun|mar|mi[ée]|jue|vie|s[áa]b|dom) (\d{2} [a-z]{3} \d{4})`);
    return parsed({ provider: this.name, category: "Viajes", total: amounts.length ? Math.max(...amounts) : null,
      invoice_number: d.find(String.raw`Air China:\s*([A-Z0-9]{6})`, 1, ""),
      issue_date: parseDate(d.find(String.raw`Fecha de emisi[óo]n del boleto (\d{4}-\d{2}-\d{2})`)),
      period_start: parseDate(flight), description: "Vuelos Air China" });
  },
};

const BoardingPass: Parser = {
  name: "Tarjeta de embarque",
  detect: (d) => d.has("Tarjeta de embarque", "Boarding Card", "BOARDING PASS") || (d.has("N° VUELO", "Nº VUELO") && d.has("TERMINAL") && d.has("ASIENTO")),
  parse() {
    return parsed({ provider: "Tarjeta de embarque", category: "Viajes", is_invoice: false,
      notes: ["Tarjeta de embarque: no es un gasto (el gasto está en la reserva)"] });
  },
};

const FlightItinerary: Parser = {
  name: "Itinerario de vuelo",
  detect: (d) => d.has("Itinerario") && d.has("Vueling", "Iberia", "Ryanair") && !d.findall(`${AMOUNT} ?(?:€|EUR)`).length,
  parse(d) {
    const flight = parseDate(d.find(String.raw`(\d{1,2} de [a-z]+ de \d{4}), \d{2}:\d{2}`));
    return parsed({ provider: d.find("(Vueling|Iberia|Ryanair)") || this.name, category: "Viajes",
      invoice_number: d.find(String.raw`\b((?=[A-Z]*\d)[A-Z0-9]{6})\b`, 1, ""), period_start: flight, issue_date: flight,
      description: "Vuelos (itinerario sin precio)", notes: ["El itinerario no indica el precio: añádelo a mano"] });
  },
};

// ---------- ocio ----------
const Tickets: Parser = {
  name: "Entradas",
  detect: (d) => d.has("Esta es tu entrada", "Entrada nominativa", "compra de entradas", "ENTRADA") && !d.has("RENFE VIAJEROS", "iryo.eu", "OUIGO"),
  parse(d) {
    const totals = d.findall(String.raw`TOTAL:?\s*(${AMOUNT})\s*€`).map(parseAmount) as number[];
    let total: number | null;
    if (totals.length) total = totals.reduce((a, b) => a + b, 0); // una línea TOTAL por entrada
    else {
      const amounts = d.findall(String.raw`(${AMOUNT})\s*€`).map(parseAmount) as number[];
      total = amounts.length ? Math.max(...amounts) : null;
    }
    const event = parseDate(d.find(`(?:[Ll]unes|[Mm]artes|[Mm]i[ée]rcoles|[Jj]ueves|[Vv]iernes|[Ss][áa]bado|[Dd]omingo), (${ANY_DATE})`));
    const bought = parseDate(d.find(String.raw`(?:Generado|Fecha de compra)\s*(${NUM_DATE})`) || d.find(`(${NUM_DATE})`));
    const what = d.find(String.raw`(Fito & Fitipaldis|CosmoCaixa|I\.D\.G\. \d{4}|Museu de la Ci[eè]ncia)`) || "Entradas";
    const n = totals.length || 1;
    return parsed({ provider: what, category: "Ocio", total: total !== null ? pyRound(total, 2) : null, issue_date: bought || event,
      period_start: event || bought, description: `${what} (${n} entrada${n !== 1 ? "s" : ""})` });
  },
};

// ---------- respaldo ----------
const TOTAL_LABELS = "TOTAL A PAGAR|TOTAL IMPORTE FACTURA|Total factura|Importe total|Total a pagar|IMPORTE TOTAL|TOTAL";
const Generic: Parser = {
  name: "Desconocido",
  detect: () => true,
  parse(d) {
    let total = d.amountAfter(TOTAL_LABELS, 2);
    if (total === null) {
      const amounts = d.findall(String.raw`(${AMOUNT})\s*(?:€|EUR)`).map(parseAmount) as number[];
      total = amounts.length ? Math.max(...amounts) : null;
    }
    const day = d.dateAfter("Fecha(?: de)? (?:emisi[óo]n|factura|cargo)") || parseDate(d.find(`(${NUM_DATE})`));
    return parsed({ provider: d.lines.length ? d.lines[0].slice(0, 60) : this.name, category: d.hint || "Otros", total,
      issue_date: day, charge_date: day, invoice_number: d.find("(?:N[ºo°]|N[úu]mero)(?: de)? factura:?\\s*([A-Z0-9/-]{4,})"),
      description: "Gasto (formato no reconocido)", confidence: "baja", notes: ["Formato no reconocido: revisa importe y fecha"] });
  },
};

export const PARSERS: Parser[] = [Octopus, Iberdrola, TotalEnergies, ASEnergia, Curenergia, Digi, BankDirectDebit,
  Mercadona, FreeNow, Voltio, Anthropic, Train, AirChina, FlightItinerary, BoardingPass, Tickets];

/** Lee el texto de una factura (como parse_text + extract_invoice de Python). */
export function parseText(text: string, filename = "", hint: string | null = null): PdfResult {
  let name: string, r: Parsed;
  if (text.trim().length < 40) {
    name = "Sin texto";
    r = parsed({ provider: "", category: hint || "Otros", is_invoice: false, confidence: "baja",
      notes: ["El PDF no tiene texto (¿escaneado?): añade el gasto a mano"] });
  } else {
    const doc = new Doc(text, filename, hint);
    const parser = PARSERS.find((p) => p.detect(doc)) ?? Generic;
    name = parser.name;
    r = parser.parse(doc);
  }
  return { is_invoice: r.is_invoice, provider: r.provider || null, category: r.category, invoice_number: r.invoice_number,
    issue_date: r.issue_date, charge_date: r.charge_date, period_start: r.period_start, period_end: r.period_end,
    total_amount: r.total, description: r.description || r.category, confidence: r.confidence,
    notes: r.notes.join(" · ") || null, parser: name };
}
