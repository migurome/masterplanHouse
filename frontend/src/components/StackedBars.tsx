import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, moneyShort, seriesColor } from "../format";

// Barras apiladas por serie (categorías en Resumen, tipos en Coche). Pulsar una barra abre sus gastos.
export type Series = { name: string; color: string | null };
export type Row = Record<string, unknown> & { label: string };

export default function StackedBars({ rows, series, height = 300, onBarClick }: {
  rows: Row[];
  series: Series[];
  height?: number;
  onBarClick?: (row: Row, series: string) => void;
}) {
  return (
    <div className={onBarClick ? "drill-chart" : undefined}>
      {onBarClick && <p className="muted small chart-hint">Pulsa una barra para ver sus gastos.</p>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" stroke="var(--axis)" tickLine={false} interval={0} height={30}
            tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <YAxis tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false} tickLine={false} width={70} />
          <Tooltip content={<ChartTooltip showTotal />} cursor={{ fill: "var(--hover)" }} />
          {series.map((s) => (
            <Bar key={s.name} dataKey={s.name} stackId="a" fill={seriesColor(s.color)} stroke="var(--surface)"
              strokeWidth={1} maxBarSize={56}
              onClick={onBarClick && ((d: { payload?: Row }) => d.payload && onBarClick(d.payload, s.name))} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color: string }[];
  showTotal?: boolean;
}

/** Tooltip de los gráficos: cada serie con su color e importe y, si se pide, el total. */
export function ChartTooltip({ active, label, payload, showTotal }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => p.value).reverse();
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {items.map((p) => (
        <div key={p.name} className="row">
          <span className="swatch" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="num">{money(p.value)}</span>
        </div>
      ))}
      {showTotal && (
        <div className="row total">
          <span />
          <span>Total</span>
          <span className="num">{money(items.reduce((sum, p) => sum + (Number(p.value) || 0), 0))}</span>
        </div>
      )}
    </div>
  );
}
