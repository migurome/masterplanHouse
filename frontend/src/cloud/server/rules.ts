/**
 * Conocimiento sobre los gastos de la casa (igual que backend/app/rules.py).
 * Para enseñarle algo nuevo (un comercio, una gasolinera...) se toca solo este archivo.
 */

// --- Gastos del coche: tipo por palabras del concepto (el primero que encaje gana)
export const CAR_KINDS: [string, string[]][] = [
  ["Seguro", ["seguro coche", "seguro del coche", "seguro auto"]],
  ["Reparaciones y mantenimiento", ["taller", "rodi ", "chapist", "neumat", "itv", "norauto", "midas", "feu vert",
    "carglass", " lavado ", "recambio", "reparacion", " revision", "aceite"]],
  ["Aparcamiento", ["parking", "parquing", "aparca", "empark", " bsm ", " ap. ", "park.", "cintra", " saba "]],
  ["Peajes", ["autopista", "peaje", "via-t", " via t "]],
  ["Gasolina", ["e.s.", "e.s ", "eess", "estacion de servicio", "gasolin", "repsol", "cepsa", "galp", "ballenoil",
    "plenoil", "plenergy", "petronor", "petroprix", "petroenergy", "shell", " bp ", "valdebebas", "carburante"]],
];
export const CAR_WORDS = CAR_KINDS.flatMap(([, words]) => words);
export const KIND_COLORS: Record<string, string> = {
  Gasolina: "#6fa3e0", "Reparaciones y mantenimiento": "#f39a73", Seguro: "#7cc4d4", Peajes: "#e07f7f", Aparcamiento: "#f2cc6b",
};

// --- Movimientos del banco: categoría sugerida por palabras del concepto (la primera que encaje gana)
export const CATEGORY_RULES: [string, string[]][] = [
  ["Luz", ["octopus", "iberdrola", "totalenergies", "curenergia", "endesa", "alquiler seguro energ", "as energy"]],
  ["Alquiler", ["alquiler seguro s.a.u", "alquiler seguro sau"]],
  ["Gas", ["naturgy", "nedgia"]],
  ["Agua", ["sabemsa", "canal de isabel", "aigues"]],
  ["Internet", ["digi spain", "digimobil", "movistar", "vodafone", "orange"]],
  ["Seguros", ["pelayo", "mapfre", "mutua", "seguros", "linea directa", "allianz", "axa "]],
  ["Supermercado", ["mercadona", "aldi", "carref", "lidl", "condis", "alcampo", "eroski", "bonpreu", "bon preu",
    "caprabo", "consum ", "ahorramas", "hipercor", "supermerc", " dia ", " spar "]],
  ["Viajes", ["renfe", "iryo", "ouigo", "vueling", "iberia", "ryanair", "air china", "hotel", "booking",
    "airbnb", "alsa ", "trainline", "trenes.com", "blablacar"]],
  ["Coche", CAR_WORDS],
  ["Transporte", ["taxi", "cabify", "uber", "free now", "freenow", "bolt", "metro", "tmb ", "emt ", "bicing",
    "voltio", "mobilitat"]],
  ["Suscripciones", ["netflix", "spotify", "hbo", "disney", "prime video", "amazon prime", "anthropic",
    "claude.ai", "openai", "apple.com", "icloud", "google one", "youtube"]],
  ["Ocio", ["cine", "teatro", "ticketmaster", "entradas", "museo"]],
  ["Salud", ["farmacia", "optica", "clinica", "dentist", "isdin"]],
  ["Restaurantes", [" bar ", "cafe", "restaura", "rest. ", "tasca", "taberna", "cerveceria", "pizzer", "kebab",
    "burger", "mcdonald", "telepizza", "pintxo", "granja", " forn ", "pasteleria", "panaderia"]],
];

// --- Comercios: cómo se agrupan movimientos parecidos
export const KEY_PREFIXES = new Set(["adeudo", "gc", "re", "compra", "pago", "cargo", "recibo", "enviado", "recibido"]);
export const KEY_STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "sl", "sa", "sau", "slu", "es", "ap"]);
export const KEY_GENERIC = new Set(["cafe", "cafeteria", "bar", "restaurante", "rest", "hotel", "farmacia", "park", "parking",
  "parquing", "alquiler", "seguro", "eess", "estacion", "servicio", "supermercado", "forn", "granja", "casa", "tasca",
  "taberna", "mi"]);

export const CONCEPT_ALIASES: Record<string, string> = {
  "alquiler seguro": "Alquiler", alquiler: "Alquiler", energy: "AS Energía", energia: "AS Energía",
  "alquiler seguro energia": "AS Energía", octopus: "Octopus Energy", digi: "DIGI", carref: "Carrefour",
  carrefour: "Carrefour", iberdrola: "Iberdrola", totalenergies: "TotalEnergies", voltio: "Voltio", moto: "Voltio",
};

export const GENERIC_MERCHANTS = new Set(["traspaso", "transferencia", "transferencias", "bizum", "www", "pago", "compra", "varios"]);

// --- Categorías periódicas: no deberían solaparse ni duplicarse con su recibo
export const PERIODIC = new Set(["Luz", "Gas", "Agua", "Internet", "Calefacción", "Calefaccion", "Comunidad", "Alquiler", "Seguros"]);

export const SAVINGS_FROM_YEAR = 2025;
export const SIN_CATEGORIA = "Sin categoría";
