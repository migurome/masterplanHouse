import { DragEvent, useState } from "react";
import { TagUsage } from "../api";
import { findOrCreateTag } from "../tags";
import { fold } from "../text";

// Arrastrar etiquetas: del panel a un gasto la pone; de un gasto a fuera (o al panel) la quita
export const TAG_MIME = "application/x-gastos-tag";
export interface TagDrag { tagId: number; from: number | null } // from: gasto de origen (null = panel)

export function startTagDrag(e: DragEvent, drag: TagDrag) {
  e.dataTransfer.setData(TAG_MIME, JSON.stringify(drag));
  e.dataTransfer.setData("text/plain", ""); // Firefox no arrastra sin datos de texto
  e.dataTransfer.effectAllowed = "copyMove";
}

export function readTagDrag(e: DragEvent): TagDrag | null {
  try {
    return JSON.parse(e.dataTransfer.getData(TAG_MIME)) as TagDrag;
  } catch {
    return null;
  }
}

export const isTagDrag = (e: DragEvent) => e.dataTransfer.types.includes(TAG_MIME);

export default function TagSidebar({ tags, activeTag, dragging, onFilter, onCreated, onDropRemove, onDragStart, onDragEnd }: {
  tags: TagUsage[];
  activeTag: string;
  dragging: TagDrag | null;
  onFilter: (tagId: string) => void;
  onCreated: () => void;
  onDropRemove: (drag: TagDrag) => void;
  onDragStart: (drag: TagDrag) => void;
  onDragEnd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const shown = tags.filter((t) => fold(t.name).includes(fold(query)));
  const exact = tags.some((t) => fold(t.name) === fold(query));
  const removing = dragging?.from != null;

  const create = async () => {
    setError(null);
    try {
      await findOrCreateTag(tags, query);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <aside
      className={`card tag-sidebar${removing ? " drop-remove" : ""}${removing && over ? " over" : ""}`}
      onDragOver={(e) => { if (removing && isTagDrag(e)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const drag = readTagDrag(e);
        setOver(false);
        if (drag?.from != null) { e.preventDefault(); e.stopPropagation(); onDropRemove(drag); }
      }}
    >
      <h2>Etiquetas</h2>
      <input type="search" aria-label="Buscar etiqueta" placeholder="Buscar o crear…" value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && query.trim() && !exact) create(); }} />
      {query.trim() && !exact && (
        <button type="button" className="ghost small" onClick={create}>+ Crear «{query.trim()}»</button>
      )}
      {error && <p className="error small">{error}</p>}
      <p className="muted small">
        {removing ? "Suelta aquí (o fuera de los gastos) para quitarla." : "Arrastra una etiqueta a un gasto para ponérsela; arrástrala fuera del gasto para quitarla."}
      </p>
      <ul className="tag-side-list">
        {shown.map((t) => (
          <li key={t.id}>
            <span
              className={`tag-chip draggable${String(t.id) === activeTag ? " active" : ""}`}
              draggable
              onDragStart={(e) => { startTagDrag(e, { tagId: t.id, from: null }); onDragStart({ tagId: t.id, from: null }); }}
              onDragEnd={onDragEnd}
              onClick={() => onFilter(String(t.id) === activeTag ? "" : String(t.id))}
              title="Arrastra a un gasto · clic para filtrar"
            >
              <i className="swatch" style={{ background: t.color ?? "var(--muted)" }} />
              {t.name}
            </span>
            <span className="muted small num">{t.count}</span>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">{tags.length ? "Ninguna coincide" : "Aún no hay etiquetas"}</li>}
      </ul>
    </aside>
  );
}
