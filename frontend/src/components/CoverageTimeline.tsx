import { useEffect, useMemo, useState } from "react";
import { api, Coverage, CoverageGap, CoverageItem } from "../api";
import { MONTHS, date, money, paletteSlot, seriesColor } from "../format";

// Timeline de periodos facturados: una fila por categoría y, en cada una, los días que cubre
// cada factura (enlace al PDF). Los huecos sin factura se marcan como "falta".

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

type Seg =
  | { kind: "item"; start: number; end: number; item: CoverageItem }
  | { kind: "gap"; start: number; end: number; gap: CoverageGap };

interface Row { category: string; color: string | null; lanes: Seg[][] }

// Reparte los periodos en carriles para que los que se solapan (regularizaciones) no se tapen
function toLanes(segs: Seg[]): Seg[][] {
  const lanes: Seg[][] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start || b.end - a.end)) {
    // Las facturas consecutivas comparten el día de corte (una acaba el 6 y la siguiente empieza el 6):
    // eso no es un solape, van en el mismo carril
    const lane = lanes.find((l) => l.at(-1)!.end <= s.start + 2 * DAY);
    if (lane) lane.push(s);
    else lanes.push([s]);
  }
  return lanes;
}

const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
  "octubre", "noviembre", "diciembre"];
const gapText = (g: CoverageGap) =>
  g.whole_month ? `falta la factura de ${MONTHS_LONG[Number(g.month.slice(5, 7)) - 1]} ${g.month.slice(0, 4)}`
    : `sin factura del ${date(g.period_from!)} al ${date(g.period_to!)}`;

function rangeText(s: Seg) {
  const from = s.kind === "item" ? s.item.period_start : s.gap.period_from!;
  const to = s.kind === "item" ? s.item.period_end : s.gap.period_to!;
  return `${date(from)} – ${date(to)}`;
}

export default function CoverageTimeline({ year }: { year: number }) {
  const [data, setData] = useState<Coverage | null>(null);
  const [hover, setHover] = useState<{ seg: Seg; x: number; y: number } | null>(null);

  useEffect(() => {
    setData(null);
    api.statsCoverage(year).then(setData);
  }, [year]);

  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const span = yearEnd - yearStart;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byCat = new Map<string, { color: string | null; segs: Seg[] }>();
    const add = (cat: string, color: string | null, seg: Seg) => {
      const r = byCat.get(cat) ?? { color, segs: [] };
      r.segs.push(seg);
      byCat.set(cat, r);
    };
    for (const item of data.items) {
      // period_end es un día incluido: la barra llega hasta el final de ese día
      add(item.category, item.color, { kind: "item", start: toTime(item.period_start), end: toTime(item.period_end) + DAY, item });
    }
    for (const gap of data.gaps) {
      const end = toTime(gap.period_to!) + (gap.whole_month ? DAY : 0);
      add(gap.category, gap.color, { kind: "gap", start: toTime(gap.period_from!), end, gap });
    }
    return [...byCat.entries()]
      .map(([category, r]) => ({ category, color: r.color, lanes: toLanes(r.segs) }))
      .sort((a, b) => paletteSlot(a.color) - paletteSlot(b.color) || a.category.localeCompare(b.category));
  }, [data]);

  const pos = (s: Seg) => {
    const start = Math.max(s.start, yearStart);
    const end = Math.min(s.end, yearEnd);
    return { left: `${((start - yearStart) / span) * 100}%`, width: `max(3px, calc(${((end - start) / span) * 100}% - 2px))` };
  };

  const today = Date.now();
  const todayPct = today >= yearStart && today < yearEnd ? ((today - yearStart) / span) * 100 : null;

  if (!data) return <p className="muted small">Cargando periodos…</p>;
  if (rows.length === 0) {
    return <p className="muted small">Ningún gasto de {year} tiene periodo de facturación.</p>;
  }

  const show = (seg: Seg) => (e: React.MouseEvent | React.FocusEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // El tooltip vive fuera del scroll horizontal para que no lo recorte; se mantiene dentro de la tarjeta
    const host = (e.currentTarget as HTMLElement).closest(".tl-wrap")!.getBoundingClientRect();
    const x = Math.min(Math.max(box.left - host.left + box.width / 2, 130), host.width - 130);
    setHover({ seg, x, y: box.top - host.top });
  };

  return (
    <>
      <div className="tl-wrap" onMouseLeave={() => setHover(null)}>
      <div className="timeline-scroll">
        <div className="timeline">
          <div className="tl-row tl-axis" aria-hidden="true">
            <span />
            <div className="tl-track">
              {MONTHS.map((m, i) => (
                <span key={m} className="tl-month" style={{ left: `${((Date.UTC(year, i, 1) - yearStart) / span) * 100}%` }}>{m}</span>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.category} className="tl-row">
              <span className="tl-label">
                <i className="swatch" style={{ background: seriesColor(row.color) }} />
                {row.category}
              </span>
              <div className="tl-track" style={{ height: `${row.lanes.length * 22 + 6}px` }}>
                {MONTHS.map((m, i) => (
                  <span key={m} className="tl-grid" style={{ left: `${((Date.UTC(year, i, 1) - yearStart) / span) * 100}%` }} />
                ))}
                {todayPct !== null && <span className="tl-today" style={{ left: `${todayPct}%` }} title="Hoy" />}
                {row.lanes.map((lane, li) => lane.map((seg) => {
                  const style = { ...pos(seg), top: `${li * 22 + 3}px` };
                  const events = { onMouseEnter: show(seg), onFocus: show(seg), onBlur: () => setHover(null) };
                  if (seg.kind === "gap") {
                    return (
                      <span key={`g-${seg.start}`} tabIndex={0} className="tl-seg tl-gap" style={style} {...events}
                        aria-label={`${row.category}: ${gapText(seg.gap)}`} />
                    );
                  }
                  const label = `${row.category}: ${rangeText(seg)}, ${money(seg.item.amount)}`;
                  return seg.item.document_id ? (
                    <a key={seg.item.id} className="tl-seg" style={{ ...style, background: seriesColor(row.color) }}
                      href={api.documentUrl(seg.item.document_id)} target="_blank" rel="noreferrer"
                      aria-label={`${label}. Abrir PDF`} {...events} />
                  ) : (
                    <span key={seg.item.id} tabIndex={0} className="tl-seg tl-manual" style={{ ...style, borderColor: seriesColor(row.color) }}
                      aria-label={`${label}. Sin PDF`} {...events} />
                  );
                }))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {hover && <TimelineTip {...hover} />}
      </div>
      <p className="tl-legend small muted">
        <span><i className="tl-key" /> periodo con PDF (clic para abrirlo)</span>
        <span><i className="tl-key tl-manual" /> gasto sin PDF</span>
        <span><i className="tl-key tl-gap" /> sin factura</span>
      </p>
      <CoverageTable items={data.items} gaps={data.gaps} />
    </>
  );
}

function TimelineTip({ seg, x, y }: { seg: Seg; x: number; y: number }) {
  return (
    <div className="chart-tooltip tl-tip" style={{ left: x, top: y }} role="status">
      {seg.kind === "gap" ? (
        <>
          <strong>Falta factura · {seg.gap.category}</strong>
          <div>{gapText(seg.gap)[0].toUpperCase() + gapText(seg.gap).slice(1)}</div>
          <div className="muted">{seg.gap.cadence === 2 ? "Factura bimestral" : "Factura mensual"}</div>
        </>
      ) : (
        <>
          <strong>{seg.item.category} · {seg.item.provider ?? seg.item.description}</strong>
          <div>Periodo: {rangeText(seg)}</div>
          <div>Importe: <b>{money(seg.item.amount)}</b> · factura del {date(seg.item.date)}</div>
          <div className="muted">{seg.item.document_id ? "Clic para abrir el PDF" : "Gasto sin PDF"}</div>
        </>
      )}
    </div>
  );
}

function CoverageTable({ items, gaps }: { items: CoverageItem[]; gaps: CoverageGap[] }) {
  return (
    <details className="table-view">
      <summary>Ver como tabla</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Categoría</th><th>Periodo</th><th>Proveedor</th><th className="num">Importe</th><th>PDF</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.category}</td>
                <td>{date(i.period_start)} – {date(i.period_end)}</td>
                <td>{i.provider ?? i.description}</td>
                <td className="num">{money(i.amount)}</td>
                <td>{i.document_id ? <a href={api.documentUrl(i.document_id)} target="_blank" rel="noreferrer">Abrir</a> : "—"}</td>
              </tr>
            ))}
            {gaps.map((g) => (
              <tr key={`${g.category}-${g.period_from}`} className="tl-gap-row">
                <td>{g.category}</td>
                <td>{date(g.period_from!)} – {date(g.period_to!)}</td>
                <td colSpan={3}>{gapText(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
