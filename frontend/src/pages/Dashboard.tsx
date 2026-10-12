import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Category, MissingInvoice, MonthStat, Summary, YearStat } from "../api";
import { MONTHS, money, paletteSlot } from "../format";
import CoverageTimeline from "../components/CoverageTimeline";
import SeriesToggle from "../components/SeriesToggle";
import StackedBars, { Row, Series } from "../components/StackedBars";
import { expensesLink } from "../drill";
import { loadPref, savePref, useStoredSet } from "../storage";

const UNCATEGORIZED = "Sin categoría";
const YEAR_KEY = "gastos.resumen.anio"; // el año elegido se recuerda al cambiar de pestaña
const HIDDEN_KEY = "gastos.resumen.ocultas";

export default function Dashboard() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<YearStat[]>([]);
  const [months, setMonths] = useState<MonthStat[]>([]);
  const [missing, setMissing] = useState<MissingInvoice[]>([]);
  const navigate = useNavigate();
  // Clic en una barra: los gastos de esa categoría en ese año (o mes) en la pestaña Gastos
  const categoryId = (name: string) => (name === UNCATEGORIZED ? 0 : categories.find((c) => c.name === name)?.id ?? null);
  const openYear = (row: Row, name: string) => navigate(expensesLink({ year: Number(row.label), categoryId: categoryId(name) }));
  const openMonth = (row: Row, name: string) =>
    year !== null && navigate(expensesLink({ year, month: Number(row.month), categoryId: categoryId(name) }));
  // Categorías desmarcadas en los gráficos "Gasto por año" y "Gasto mensual"
  const [hidden, toggle, setAllHidden] = useStoredSet(HIDDEN_KEY);
  const [toReview, setToReview] = useState<number | null>(null);

  useEffect(() => {
    api.categories().then(setCategories);
    api.summary().then((s) => {
      setSummary(s);
      const saved = loadPref<number | null>(YEAR_KEY, null);
      setYear(saved && s.years.includes(saved) ? saved : s.years.at(-1) ?? new Date().getFullYear());
    });
  }, []);

  useEffect(() => {
    api.statsYears().then(setYears);
    api.review().then((r) => setToReview(r.total)).catch(() => {});
  }, []);

  useEffect(() => {
    if (year === null) return;
    api.statsMonths({ year }).then(setMonths);
    api.statsMissing({ year }).then(setMissing);
  }, [year]);

  // Las series se apilan en el orden de la paleta (validado para que los vecinos se distingan)
  // y cada categoría conserva siempre su color.
  const series = useMemo<Series[]>(() => {
    const present = new Set<string>();
    for (const r of [...years, ...months]) Object.keys(r.by_category).forEach((k) => present.add(k));
    const list = categories
      .filter((c) => present.has(c.name))
      .sort((a, b) => paletteSlot(a.color) - paletteSlot(b.color))
      .map((c) => ({ name: c.name, color: c.color }));
    if (present.has(UNCATEGORIZED)) list.push({ name: UNCATEGORIZED, color: null });
    return list;
  }, [categories, years, months]);

  const yearRows = years.map((y) => ({ label: String(y.year), total: y.total, ...y.by_category }));
  const monthRows = months.map((m) => ({
    label: MONTHS[m.month - 1], month: m.month, total: m.total, ...m.by_category,
  }));

  const current = years.find((y) => y.year === year);
  const previous = years.find((y) => y.year === (year ?? 0) - 1);
  const monthsWithData = months.filter((m) => m.total > 0).length;

  if (!summary) return null;
  if (summary.years.length === 0) {
    return (
      <section className="empty card">
        <h2>Aún no hay gastos</h2>
        <p>Empieza <Link to="/subir">subiendo facturas en PDF</Link> o <Link to="/gastos">añadiendo un gasto a mano</Link>.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="filters">
        <label>
          Año
          <select id="f-year" value={year ?? ""} onChange={(e) => {
            setYear(Number(e.target.value));
            savePref(YEAR_KEY, Number(e.target.value));
          }}>
            {summary.years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className="tiles">
        <div className="tile card">
          <span className="tile-label">Total {year}</span>
          <span className="tile-value">{money(current?.total ?? 0)}</span>
          {previous && current && <span className="tile-sub">{previous.year}: {money(previous.total)}</span>}
        </div>
        <div className="tile card">
          <span className="tile-label">Media mensual {year}</span>
          <span className="tile-value">{money(monthsWithData ? (current?.total ?? 0) / monthsWithData : 0)}</span>
          <span className="tile-sub">sobre {monthsWithData} meses con gastos</span>
        </div>
        <Link to="/revisar" className="tile card">
          <span className="tile-label">Pendiente de revisar</span>
          <span className="tile-value">{toReview ?? "…"}</span>
          <span className="tile-sub">avisos en la pestaña Revisar</span>
        </Link>
        <a href="#periodos" className="tile card">
          <span className="tile-label">Facturas que faltan {year}</span>
          <span className="tile-value">{missing.length}</span>
          <span className="tile-sub">ver en el timeline de periodos</span>
        </a>
      </div>

      <section className="card">
        <h2>Gasto por año</h2>
        <SeriesToggle series={series} hidden={hidden} onToggle={toggle} onAll={setAllHidden} />
        <StackedBars rows={yearRows} series={series.filter((s) => !hidden.has(s.name))} onBarClick={openYear} />
        <YearTable years={years} series={series} />
      </section>

      <section className="card">
        <h2>Gasto mensual {year}</h2>
        <SeriesToggle series={series} hidden={hidden} onToggle={toggle} onAll={setAllHidden} />
        <StackedBars rows={monthRows} series={series.filter((s) => !hidden.has(s.name))} onBarClick={openMonth} />
      </section>

      {year !== null && (
        <section className="card" id="periodos">
          <h2>Periodos cubiertos {year}</h2>
          <p className="muted small section-sub">Días que cubre cada factura; pulsa un periodo para abrir su PDF.</p>
          <CoverageTimeline year={year} />
        </section>
      )}

    </div>
  );
}

function YearTable({ years, series }: { years: YearStat[]; series: Series[] }) {
  return (
    <details className="table-view">
      <summary>Ver como tabla</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              {years.map((y) => <th key={y.year} className="num">{y.year}</th>)}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                {years.map((y) => <td key={y.year} className="num">{y.by_category[s.name] ? money(y.by_category[s.name]) : "—"}</td>)}
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              {years.map((y) => <td key={y.year} className="num">{money(y.total)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
