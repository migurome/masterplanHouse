/** Comercios y conceptos (igual que backend/app/merchants.py) y tipo de gasto del coche (backend/app/car.py). */
import { fold, title } from "./py";
import { CAR_KINDS, CONCEPT_ALIASES, KEY_GENERIC, KEY_PREFIXES, KEY_STOP } from "./rules";

export function merchantKey(text: string): string {
  const words = (fold(text).match(/[a-z0-9]+/g) ?? []).filter((w) => !/\d/.test(w));
  while (words.length && KEY_PREFIXES.has(words[0])) words.shift();
  const key: string[] = [];
  for (const w of words) {
    if (KEY_STOP.has(w) || w.length < 3) continue;
    key.push(w);
    if (!KEY_GENERIC.has(w)) break;
  }
  return key.join(" ") || fold(text).replace(/\s+/g, " ").trim();
}

interface Texts { provider: string | null; description: string; source?: string; notes?: string | null }

export const expenseMerchant = (e: Texts) => merchantKey(e.provider || e.description || "");

export function concept(e: Texts): string {
  let text = e.provider || e.description;
  if (e.source === "banco") {
    text = e.description;
    const f = fold(text);
    if ((f.startsWith("traspaso") || f.startsWith("transferencia") || f.startsWith("bizum")) && e.notes) text = e.notes.split(" · ")[0];
  }
  const key = merchantKey(text || "");
  return CONCEPT_ALIASES[key] || title(key) || "Sin concepto";
}

// ---------- coche ----------
export const OTHER_KIND = "Otros";
export const KINDS = [...CAR_KINDS.map(([k]) => k), OTHER_KIND];
export const KIND_TAGS = CAR_KINDS.map(([k]) => k).reverse(); // Gasolina, Peajes, Aparcamiento, Reparaciones…, Seguro

export function carKind(...texts: (string | null | undefined)[]): string {
  const t = " " + texts.map((x) => fold(x || "")).join(" ").replaceAll(",", " ") + " ";
  for (const [kind, words] of CAR_KINDS) if (words.some((w) => t.includes(w))) return kind;
  return OTHER_KIND;
}

interface CarExpense extends Texts { id: number; tagNames: string[] }

export const taggedKind = (e: { tagNames: string[] }) => KIND_TAGS.find((k) => e.tagNames.includes(k)) ?? null;

/** Tipo de cada gasto del coche: su etiqueta, la del mismo comercio o la deducida del texto. */
export function carKinds(expenses: CarExpense[]): Map<number, string> {
  const byMerchant = new Map<string, string>();
  for (const e of expenses) {
    const k = taggedKind(e);
    if (k && !byMerchant.has(expenseMerchant(e))) byMerchant.set(expenseMerchant(e), k);
  }
  return new Map(expenses.map((e) => [e.id,
    taggedKind(e) ?? byMerchant.get(expenseMerchant(e)) ?? carKind(e.description, e.provider, e.notes)]));
}
