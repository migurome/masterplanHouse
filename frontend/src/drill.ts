// Enlace a la pestaña Gastos con los gastos que forman una barra de un gráfico

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();

export function expensesLink(opts: {
  year: number;
  month?: number; // 1-12: solo ese mes
  monthTo?: number; // 1-12: de enero hasta ese mes (comparativas del mismo periodo)
  categoryId?: number | null; // 0 = sin categoría
  carKind?: string; // tipo de gasto del coche (Gasolina, Seguro…)
}) {
  const p = new URLSearchParams();
  const { year, month, monthTo } = opts;
  if (month) {
    p.set("desde", `${year}-${pad(month)}-01`);
    p.set("hasta", `${year}-${pad(month)}-${lastDay(year, month)}`);
  } else if (monthTo && monthTo < 12) {
    p.set("desde", `${year}-01-01`);
    p.set("hasta", `${year}-${pad(monthTo)}-${lastDay(year, monthTo)}`);
  } else {
    p.set("anio", String(year));
  }
  if (opts.categoryId != null) p.set("categoria", String(opts.categoryId));
  if (opts.carKind) p.set("coche", opts.carKind);
  return `/gastos?${p}`;
}
