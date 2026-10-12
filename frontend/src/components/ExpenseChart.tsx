import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Category, Expense } from "../api";
import { date, money, moneyShort, MONTHS, PALETTE, seriesColor } from "../format";

// Gráfica de los gastos de la lista (o de los marcados): cuánto suman y en qué se reparten
export type GroupBy = "categoria" | "concepto" | "etiqueta" | "mes";
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "categoria", label: "Categoría" },
  { id: "concepto", label: "Concepto" },
  { id: "etiqueta", label: "Etiqueta" },
  { id: "mes", label: "Mes" },
];
const MAX_BARS = 12;
const ACCENT = PALETTE[0];
const REST = "#bdbab3";

interface Row { name: string; amount: number; count: number; color: string }

export default function ExpenseChart({ expenses, categories, groupBy, onGroupBy, scope }: {
  expenses: Expense[];
  categories: Category[];
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  scope: string; // "los 23 gastos marcados" / "los 120 gastos de la lista"
}) {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const dates = expenses.map((e) => e.date).sort();

  const rows = useMemo(() => {
    const acc = new Map<string, Row>();
    const put = (name: string, amount: number, color: string) => {
      const r = acc.get(name) ?? { name, amount: 0, count: 0, color };
      r.amount += amount;
      r.count += 1;
      acc.set(name, r);
    };
    for (const e of expenses) {
      if (groupBy === "categoria") {
        put(e.category ?? "Sin categoría", e.amount, seriesColor(categories.find((c) => c.name === e.category)?.color));
      } else if (groupBy === "concepto") {
        put(e.concept || e.description || "Sin concepto", e.amount, ACCENT);
      } else if (groupBy === "etiqueta") {
        // Un gasto con dos etiquetas cuenta en las dos (la suma de las barras puede pasar del total)
        if (e.tags.length === 0) put("Sin etiqueta", e.amount, REST);
        for (const t of e.tags) put(t.name, e.amount, t.color ?? ACCENT);
      } else {
        put(e.date.slice(0, 7), e.amount, ACCENT);
      }
    }
    let list = [...acc.values()];
    if (groupBy === "mes") return list.sort((a, b) => a.name.localeCompare(b.name));
    list.sort((a, b) => b.amount - a.amount);
    if (list.length > MAX_BARS) {
      const rest = list.slice(MAX_BARS - 1);
      list = [...list.slice(0, MAX_BARS - 1), {
        name: `Resto (${rest.length})`, amount: rest.reduce((s, r) => s + r.amount, 0),
        count: rest.reduce((s, r) => s + r.count, 0), color: REST,
      }];
    }
    return list;
  }, [expenses, categories, groupBy]);

  const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
  const chartRows = rows.map((r) => ({ ...r, label: groupBy === "mes" ? monthLabel(r.name) : r.name }));

  if (expenses.length === 0) return <p className="muted">No hay gastos que dibujar.</p>;

  return (
    <div className="expense-chart">
      <div className="tiles">
        <div className="tile card">
          <span className="tile-label">Total</span>
          <span className="tile-value">{money(total)}</span>
          <span className="tile-sub">{scope}</span>
        </div>
        <div className="tile card">
          <span className="tile-label">Gastos</span>
          <span className="tile-value">{expenses.length}</span>
          <span className="tile-sub">media {money(total / expenses.length)}</span>
        </div>
        <div className="tile card">
          <span className="tile-label">Periodo</span>
          <span className="tile-value tile-text">{date(dates[0])}</span>
          <span className="tile-sub">al {date(dates.at(-1)!)}</span>
        </div>
        {groupBy !== "mes" && rows[0] && (
          <div className="tile card">
            <span className="tile-label">Lo que más</span>
            <span className="tile-value tile-text">{rows[0].name}</span>
            <span className="tile-sub">{money(rows[0].amount)} · {Math.round((rows[0].amount / (total || 1)) * 100)} %</span>
          </div>
        )}
      </div>

      <div className="group-tabs">
        <span className="muted small">Agrupar por</span>
        <div className="tabs" role="tablist" aria-label="Agrupar por">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={groupBy === g.id}
              className={groupBy === g.id ? "tab active" : "tab"} onClick={() => onGroupBy(g.id)}>{g.label}</button>
          ))}
        </div>
      </div>

      {groupBy === "mes" ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" stroke="var(--axis)" tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip cursor={{ fill: "var(--hover)" }} content={<RowTooltip />} />
            <Bar dataKey="amount" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, chartRows.length * 32 + 24)}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 90, left: 8, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={170} stroke="var(--axis)" tickLine={false} interval={0}
              tick={{ fill: "var(--text-2)", fontSize: 12 }} />
            <Tooltip cursor={{ fill: "var(--hover)" }} content={<RowTooltip />} />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {chartRows.map((r) => <Cell key={r.name} fill={r.color} />)}
              <LabelList dataKey="amount" position="right" formatter={(v: number) => money(v)}
                style={{ fill: "var(--text-2)", fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {groupBy === "etiqueta" && <p className="muted small">Un gasto con varias etiquetas cuenta en cada una.</p>}

      <details className="table-view">
        <summary>Ver como tabla</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{GROUPS.find((g) => g.id === groupBy)?.label}</th><th className="num">Gastos</th><th className="num">Importe</th><th className="num">%</th></tr></thead>
            <tbody>
              {chartRows.map((r) => (
                <tr key={r.name}>
                  <td><i className="swatch" style={{ background: r.color }} /> {r.label}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td className="num">{Math.round((r.amount / (total || 1)) * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function RowTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row & { label: string } }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{r.label}</strong>
      <div className="row"><span className="swatch" style={{ background: r.color }} /><span>{r.count} gastos</span><span className="num">{money(r.amount)}</span></div>
    </div>
  );
}
