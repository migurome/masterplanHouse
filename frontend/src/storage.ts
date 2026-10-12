import { useState } from "react";

// Preferencias de la vista que se recuerdan en el navegador (año elegido, series ocultas...).
// Si el navegador no deja guardar, solo duran mientras la página está abierta.

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento */
  }
}

/** Conjunto de nombres recordado (p. ej. las series desmarcadas de un gráfico). */
export function useStoredSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => new Set(loadPref<string[]>(key, [])));
  const replace = (names: string[]) => {
    setSet(new Set(names));
    savePref(key, names);
  };
  const toggle = (name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    replace([...next]);
  };
  return [set, toggle, replace] as const;
}
