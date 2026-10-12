import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CarData } from "../api";
import { date, money, MONTHS, PALETTE } from "../format";
import { pct } from "../insights";
import SeriesToggle from "../components/SeriesToggle";
import StackedBars, { Row as BarRow } from "../components/StackedBars";
import { useStoredSet } from "../storage";
import { expensesLink } from "../drill";

// Apartado del coche: todo lo que cuesta (gasolina, reparaciones, seguro, peajes, aparcamiento) por año y mes.

const ORDER = ["Gasolina", "Reparaciones y mantenimiento", "Seguro", "Peajes", "Aparcamiento", "Otros"];
// Colores de la paleta validada en su orden (vecinos distinguibles también con daltonismo); "Otros" en gris
const kindColor = (k: string) => (k === "Otros" ? "#bdbab3" : PALETTE[ORDER.indexOf(k) % PALETTE.length]);
const yearOf = (d: string) => Number(d.slice(0, 4));

type Row = Record<string, number | string>;

export default function Car() {
  const [data, setData] = useState<CarData | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const navigate = useNavigate();
  // Tipos desmarcados en los gráficos (se recuerdan al volver a la pestaña)
  const [hidden, toggle, setAllHidden] = useStoredSet("gastos.coche.ocultos");

  useEffect(() => {
    api.statsCar().then((d) => {
      setData(d);
      const ys = d.items.map((i) => yearOf(i.date));
      setYear(ys.length ? Math.max(...ys) : new Date().getFullYear());
    });
  }, []);

  const kinds = useMemo(() => ORDER.filter((k) => data?.items.some((i) => i.kind === k)), [data]);
  const series = kinds.map((k) => ({ name: k, color: kindColor(k) }));
  const shown = series.filter((s) => !hidden.has(s.name));
  const years = useMemo(() => [...new Set(data?.items.map((i) => yearOf(i.date)) ?? [])].sort(), [data]);

  const sum = (rows: Row[], key: (d: string) => number) => {
    for (const i of data?.items ?? []) {
      const row = rows[key(i.date)];
      if (!row) continue;
      row[i.kind] = Number(row[i.kind] ?? 0) + i.amount;
      row.total = Number(row.total) + i.amount;
    }
    return rows;
  };
  const byYear = useMemo(() => sum(years.map((y) => ({ label: String(y), total: 0 })), (d) => years.indexOf(yearOf(d))), [data, years]);
  const byMonth = useMemo(
    () => sum(MONTHS.map((label, i) => ({ label, month: i + 1, total: 0 })), (d) => (yearOf(d) === year ? Number(d.slice(5, 7)) - 1 : -1)),
    [data, year],
  );

  if (!data) return <p className="muted">Cargando…</p>;
  if (data.items.length === 0) {
    return <section className="card"><h2>Coche</h2><p className="muted">Aún no hay gastos en la categoría Coche.</p></section>;
  }

  const current = byYear.find((r) => r.label === String(year));
  const previous = byYear.find((r) => r.label === String((year ?? 0) - 1));
  const total = Number(current?.total ?? 0);
  const now = new Date();
  const monthsCount = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const topKind = kinds.map((k) => [k, Number(current?.[k] ?? 0)] as const).sort((a, b) => b[1] - a[1])[0];
  const list = data.items.filter((i) => yearOf(i.date) === year && (!kindFilter || i.kind === kindFilter));

  return (
    <div className="stack">
      <div className="filters">
        <label>
          Año
          <select value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className="tiles">
        <div className="tile card">
          <span className="tile-label">Coche {year}</span>
          <span className="tile-value">{money(total)}</span>
          {previous && <span className="tile-sub">{previous.label}: {money(Number(previous.total))} ({pct(Number(previous.total), total)})</span>}
        </div>
        <div className="tile card">
          <span className="tile-label">Al mes</span>
          <span className="tile-value">{money(total / monthsCount)}</span>
          <span className="tile-sub">media de {monthsCount} meses</span>
        </div>
        {topKind && topKind[1] > 0 && (
          <div className="tile card">
            <span className="tile-label">Lo que más cuesta</span>
            <span className="tile-value tile-text">{topKind[0]}</span>
            <span className="tile-sub">{money(topKind[1])} · {Math.round((topKind[1] / (total || 1)) * 100)} % del coche</span>
          </div>
        )}
      </div>

      <section className="card">
        <h2>Coche por año</h2>
        <SeriesToggle series={series} hidden={hidden} onToggle={toggle} onAll={setAllHidden} label="Tipos de gasto del coche" />
        <StackedBars rows={byYear as BarRow[]} series={shown} height={280}
          onBarClick={(row, kind) => navigate(expensesLink({ year: Number(row.label), carKind: kind }))} />
        <div className="table-scroll compare-table">
          <table>
            <thead>
              <tr><th>Tipo</th>{years.map((y) => <th key={y} className="num">{y}</th>)}</tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k} onClick={() => setKindFilter(k)} className={kindFilter === k ? "selected" : ""}>
                  <td><i className="swatch" style={{ background: kindColor(k) }} /> {k}</td>
                  {byYear.map((r) => <td key={r.label} className="num">{r[k] ? money(Number(r[k])) : "—"}</td>)}
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                {byYear.map((r) => <td key={r.label} className="num">{money(Number(r.total))}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Coche mes a mes {year}</h2>
        <SeriesToggle series={series} hidden={hidden} onToggle={toggle} onAll={setAllHidden} label="Tipos de gasto del coche" />
        <StackedBars rows={byMonth as BarRow[]} series={shown} height={280}
          onBarClick={(row, kind) => year && navigate(expensesLink({ year, month: Number(row.month), carKind: kind }))} />
      </section>

      <section className="card">
        <div className="table-head">
          <h2>Gastos del coche {year}</h2>
          <label>
            Tipo
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">Todos</option>
              {kinds.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap">{date(i.date)}</td>
                  <td>{i.description}</td>
                  <td><i className="swatch" style={{ background: kindColor(i.kind) }} /> {i.kind}</td>
                  <td className="num nowrap">{money(i.amount)}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="muted">No hay gastos con este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          El tipo de cada gasto es una etiqueta (Gasolina, Peajes, Aparcamiento, Reparaciones y mantenimiento, Seguro).
          Para corregirlo, en Gastos arrastra la etiqueta buena al gasto: sustituye a la que tuviera, y los gastos
          del mismo comercio sin etiqueta la siguen. Un gasto nuevo con la categoría Coche toma el tipo de su
          comercio o lo deduce del concepto; sin etiqueta queda en Otros.
        </p>
      </section>
    </div>
  );
}
