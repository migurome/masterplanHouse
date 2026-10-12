// Sin mayúsculas ni acentos: "Tren" y "trén" se comparan igual
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
