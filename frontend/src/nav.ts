// Pestañas del menú. Cada usuario puede reordenarlas (arrastrándolas o en Ajustes); el orden se guarda en el servidor.
export interface NavItem { path: string; label: string }

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Resumen" },
  { path: "/gastos", label: "Gastos" },
  { path: "/revisar", label: "Revisar" },
  { path: "/comparar", label: "Comparar" },
  { path: "/coche", label: "Coche" },
  { path: "/ahorro", label: "Ahorro" },
  { path: "/importar", label: "Importar" },
  { path: "/actividad", label: "Actividad" },
  { path: "/ajustes", label: "Ajustes" },
];

/** Pestañas en el orden guardado; las nuevas (que el orden guardado no conoce) van al final. */
export function orderNav(saved: string[] | undefined): NavItem[] {
  const byPath = new Map(NAV_ITEMS.map((i) => [i.path, i]));
  const first = (saved ?? []).map((p) => byPath.get(p)).filter((i): i is NavItem => !!i);
  return [...first, ...NAV_ITEMS.filter((i) => !first.includes(i))];
}

/** Mueve la pestaña `from` a la posición de `to`. */
export function moveNav(items: NavItem[], from: string, to: string): NavItem[] {
  const list = items.filter((i) => i.path !== from);
  const moved = items.find((i) => i.path === from);
  const at = list.findIndex((i) => i.path === to);
  if (!moved || at < 0) return items;
  const after = items.findIndex((i) => i.path === from) < items.findIndex((i) => i.path === to);
  list.splice(after ? at + 1 : at, 0, moved);
  return list;
}
