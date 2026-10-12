import { seriesColor } from "../format";

// Casillas para marcar o desmarcar categorías; hacen también de leyenda (el color sigue a la categoría)
export default function SeriesToggle({ series, hidden, onToggle, onAll, label = "Categorías mostradas" }: {
  label?: string;
  series: { name: string; color: string | null }[]; hidden: Set<string>; onToggle: (name: string) => void; onAll: (hidden: string[]) => void;
}) {
  const allOn = series.every((s) => !hidden.has(s.name));
  return (
    <fieldset className="series-toggle">
      <legend className="sr-only">{label}</legend>
      {series.map((s) => (
        <label key={s.name} className={hidden.has(s.name) ? "off" : ""}>
          <input type="checkbox" checked={!hidden.has(s.name)} onChange={() => onToggle(s.name)} />
          <i className="swatch" style={{ background: seriesColor(s.color) }} />
          {s.name}
        </label>
      ))}
      <button type="button" className="link-button small" onClick={() => onAll(allOn ? series.map((s) => s.name) : [])}>
        {allOn ? "Desmarcar todo" : "Marcar todo"}
      </button>
    </fieldset>
  );
}
