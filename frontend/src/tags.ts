import { api, Tag } from "./api";
import { PALETTE } from "./format";
import { fold } from "./text";

// Color de una etiqueta nueva: los de la paleta, por orden
export function tagColor(n: number) {
  return PALETTE[n % PALETTE.length];
}

/** La etiqueta con ese nombre (sin distinguir mayúsculas ni acentos) o, si no existe, una nueva. */
export async function findOrCreateTag(tags: Tag[], name: string): Promise<{ tag: Tag; created: boolean }> {
  const found = tags.find((t) => fold(t.name) === fold(name));
  if (found) return { tag: found, created: false };
  return { tag: await api.createTag({ name: name.trim(), color: tagColor(tags.length) }), created: true };
}
