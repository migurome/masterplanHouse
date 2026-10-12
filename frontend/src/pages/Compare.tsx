import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Breakdown, Category } from "../api";
import { expensesLink } from "../drill";
import { money, moneyShort, paletteSlot, seriesColor } from "../format";
import { buildInsights, pct, share, Totals } from "../insights";

// Comparativa entre años: categorías y conceptos por año, con conclusiones automáticas.

const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
  "octubre", "noviembre", "diciembre"];
// Un tono, de claro (años antiguos) a intenso (el último): el color ordena los años, no los distingue por tipo
const YEAR_VARS = ["--yr-0", "--yr-1", "--yr-2", "--yr-3", "--yr-4", "--yr-5"];
const yearColor = (i: number, n: number) => `var(${YEAR_VARS[Math.max(0, YEAR_VARS.length - n + i)]})`;

const add = (m: Map<number, number>, y: number, v: number) => m.set(y, (m.get(y) ?? 0) + v);
const val = (t: Totals | undefined, y: number) => t?.get(y) ?? 0;

export default function Compare() {
  const [data, setData] = useState<Breakdown | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [samePeriod, setSamePeriod] = useState(true);
  const [focus, setFocus] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.categories().then(setCats);
    api.statsBreakdown().then((d) => {
      setData(d);
      setSelected(new Set(d.rows.map((r) => r.year)));
    });
  }, []);

  const allYears = useMemo(() => [...new Set(data?.rows.map((r) => r.year) ?? [])].sort(), [data]);
  const years = allYears.filter((y) => selected.has(y));
  const last = years.at(-1);
  // Último mes con gastos del año más reciente: si está a medias, se comparan los mismos meses de cada año
  const lastMonth = useMemo(
    () => Math.max(0, ...(data?.rows.filter((r) => r.year === last).map((r) => r.month) ?? [0])),
    [data, last],
  );
  const partial = lastMonth > 0 && lastMonth < 12;
  const months = samePeriod && partial ? lastMonth : 12;
  const periodLabel = months < 12 ? ` (enero–${MONTHS_LONG[months - 1]})` : "";

  const agg = useMemo(() => {
    const total: Totals = new Map();
    const byCategory = new Map<string, Totals>();
    const byConcept = new Map<string, { category: string; totals: Totals }>();
    for (const r of data?.rows ?? []) {
      if (!selected.has(r.year) || r.month > months) continue;
      add(total, r.year, r.amount);
      if (!byCategory.has(r.category)) byCategory.set(r.category, new Map());
      add(byCategory.get(r.category)!, r.year, r.amount);
      const key = `${r.concept} · ${r.category}`;
      if (!byConcept.has(key)) byConcept.set(key, { category: r.category, totals: new Map() });
      add(byConcept.get(key)!.totals, r.year, r.amount);
    }
    return { total, byCategory, byConcept };
  }, [data, selected, months]);

  const insights = useMemo(() => buildInsights({
    years, total: agg.total, byCategory: agg.byCategory, months, periodLabel,
    byConcept: new Map([...agg.byConcept.entries()].map(([k, v]) => [k.split(" · ")[0], v])),
  }), [agg, years.join(), months, periodLabel]);

  if (!data) return <p className="muted">Cargando…</p>;
  if (allYears.length === 0) return <p className="muted">Aún no hay gastos que comparar.</p>;

  const first = years[0];
  const categories = [...agg.byCategory.entries()]
    .map(([name, t]) => ({ name, t, lastValue: last ? val(t, last) : 0 }))
    .sort((a, b) => b.lastValue - a.lastValue || paletteSlot(data.colors[a.name]) - paletteSlot(data.colors[b.name]));
  const chartRows = categories.map((c) => ({ name: c.name, ...Object.fromEntries(years.map((y) => [String(y), val(c.t, y)])) }));

  const focusCat = focus || categories[0]?.name || "";
  const concepts = [...agg.byConcept.entries()]
    .filter(([, v]) => focusCat === "*" || v.category === focusCat)
    .map(([k, v]) => ({ name: focusCat === "*" ? k : k.split(" · ")[0], t: v.totals }))
    .sort((a, b) => (last ? val(b.t, last) - val(a.t, last) : 0) || val(b.t, first) - val(a.t, first))
    .slice(0, 20);

  const toggleYear = (y: number) => {
    const next = new Set(selected);
    if (next.has(y)) next.delete(y);
    else next.add(y);
    if (next.size > 0) setSelected(next);
  };

  return (
    <div className="stack">
      <div className="filters">
        <fieldset className="series-toggle year-toggle">
          <legend>Años</legend>
          {allYears.map((y) => (
            <label key={y} className={selected.has(y) ? "" : "off"}>
              <input type="checkbox" checked={selected.has(y)} onChange={() => toggleYear(y)} />
              {y}
            </label>
          ))}
        </fieldset>
        {partial && (
          <label className="check">
            <input type="checkbox" checked={samePeriod} onChange={(e) => setSamePeriod(e.target.checked)} />
            Comparar solo enero–{MONTHS_LONG[lastMonth - 1]} ({last} va hasta {MONTHS_LONG[lastMonth - 1]})
          </label>
        )}
      </div>

      <div className="tiles">
        {years.map((y, i) => (
          <div key={y} className="tile card">
            <span className="tile-label">{y}{periodLabel}</span>
            <span className="tile-value">{money(val(agg.total, y))}</span>
            <span className="tile-sub">
              {money(val(agg.total, y) / months)} al mes
              {i > 0 && ` · ${pct(val(agg.total, years[i - 1]), val(agg.total, y))} vs ${years[i - 1]}`}
            </span>
          </div>
        ))}
      </div>

      <section className="card">
        <h2>Conclusiones</h2>
        <p className="muted small section-sub">
          Calculadas con tus datos{periodLabel && `, comparando ${periodLabel.trim().slice(1, -1)} de cada año`}.
          {years.length > 1 && ` Las variaciones van de ${first} a ${last}.`}
        </p>
        <div className="insights">
          {insights.map((ins) => (
            <article key={ins.kind} className={`insight insight-${ins.kind}`}>
              <h3>{ins.title}</h3>
              <ul>{ins.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Categorías por año{periodLabel}</h2>
        <div className="drill-chart">
        <p className="muted small chart-hint">Pulsa una barra para ver sus gastos.</p>
        <ResponsiveContainer width="100%" height={Math.max(240, categories.length * (years.length * 9 + 18) + 40)}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={1}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={110} stroke="var(--axis)" tickLine={false}
              tick={{ fill: "var(--text-2)", fontSize: 12 }} interval={0} />
            <Tooltip cursor={{ fill: "var(--hover)" }} content={<YearTooltip years={years} />} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" iconSize={10}
              formatter={(v: string) => <span style={{ color: "var(--text-2)" }}>{v}</span>} />
            {years.map((y, i) => (
              <Bar key={y} dataKey={String(y)} fill={yearColor(i, years.length)} radius={[0, 4, 4, 0]} maxBarSize={14}
                onClick={(d: { payload?: { name: string } }) => d.payload && navigate(expensesLink({
                  year: y, monthTo: months,
                  categoryId: cats.find((c) => c.name === d.payload!.name)?.id ?? (d.payload.name === "Sin categoría" ? 0 : null),
                }))} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>

        <div className="table-scroll compare-table">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                {years.map((y) => <th key={y} className="num">{y}</th>)}
                {years.length > 1 && <><th className="num">Diferencia</th><th className="num">%</th></>}
                <th className="num">Peso {last}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.name} className={focusCat === c.name ? "selected" : ""} onClick={() => setFocus(c.name)}>
                  <td><i className="swatch" style={{ background: seriesColor(data.colors[c.name]) }} /> {c.name}</td>
                  {years.map((y) => <td key={y} className="num">{money(val(c.t, y))}</td>)}
                  {years.length > 1 && (
                    <>
                      <td className="num">{money(val(c.t, last!) - val(c.t, first))}</td>
                      <td className="num">{pct(val(c.t, first), val(c.t, last!))}</td>
                    </>
                  )}
                  <td className="num">{share(val(c.t, last!) / (val(agg.total, last!) || 1))}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                {years.map((y) => <td key={y} className="num">{money(val(agg.total, y))}</td>)}
                {years.length > 1 && (
                  <>
                    <td className="num">{money(val(agg.total, last!) - val(agg.total, first))}</td>
                    <td className="num">{pct(val(agg.total, first), val(agg.total, last!))}</td>
                  </>
                )}
                <td className="num">100 %</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">Pulsa una categoría para ver sus conceptos abajo.</p>
      </section>

      <section className="card" id="conceptos">
        <div className="table-head">
          <h2>Conceptos por año</h2>
          <label>
            Categoría
            <select value={focusCat} onChange={(e) => setFocus(e.target.value)}>
              <option value="*">Todas (20 principales)</option>
              {categories.map((c) => <option key={c.name}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll compare-table">
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                {years.map((y) => <th key={y} className="num">{y}</th>)}
                {years.length > 1 && <><th className="num">Diferencia</th><th className="num">%</th></>}
              </tr>
            </thead>
            <tbody>
              {concepts.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  {years.map((y) => <td key={y} className="num">{val(c.t, y) ? money(val(c.t, y)) : "—"}</td>)}
                  {years.length > 1 && (
                    <>
                      <td className="num">{money(val(c.t, last!) - val(c.t, first))}</td>
                      <td className="num">{pct(val(c.t, first), val(c.t, last!))}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function YearTooltip({ active, label, payload, years }: {
  active?: boolean; label?: string; payload?: { dataKey: string; value: number; color: string }[]; years: number[];
}) {
  if (!active || !payload?.length) return null;
  const byYear = new Map(payload.map((p) => [Number(p.dataKey), p]));
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {years.map((y, i) => {
        const p = byYear.get(y);
        const prev = i > 0 ? byYear.get(years[i - 1])?.value ?? 0 : null;
        return (
          <div key={y} className="row">
            <span className="swatch" style={{ background: p?.color }} />
            <span>{y}{prev !== null && <span className="muted"> · {pct(prev, p?.value ?? 0)}</span>}</span>
            <span className="num">{money(p?.value ?? 0)}</span>
          </div>
        );
      })}
    </div>
  );
}
