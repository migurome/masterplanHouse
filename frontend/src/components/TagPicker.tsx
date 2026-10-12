import { KeyboardEvent, useState } from "react";
import { Tag } from "../api";
import { findOrCreateTag } from "../tags";

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="tag-chip">
      <i className="swatch" style={{ background: tag.color ?? "var(--muted)" }} />
      {tag.name}
      {onRemove && (
        <button type="button" className="tag-remove" aria-label={`Quitar ${tag.name}`} onClick={onRemove}>×</button>
      )}
    </span>
  );
}

// Elige etiquetas existentes o crea una nueva escribiendo su nombre
export default function TagPicker({ tags, value, onChange, onCreated }: {
  tags: Tag[];
  value: number[];
  onChange: (ids: number[]) => void;
  onCreated: (tag: Tag) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = value.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const free = tags.filter((t) => !value.includes(t.id));

  const add = async () => {
    const name = text.trim();
    if (!name) return;
    setError(null);
    let tag: Tag;
    try {
      const r = await findOrCreateTag(tags, name);
      tag = r.tag;
      if (r.created) onCreated(tag);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (!value.includes(tag.id)) onChange([...value, tag.id]);
    setText("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // no enviar el formulario del gasto
      add();
    }
  };

  return (
    <div className="tag-picker">
      <div className="tag-list">
        {selected.map((t) => <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((id) => id !== t.id))} />)}
        {selected.length === 0 && <span className="muted small">Sin etiquetas</span>}
      </div>
      <div className="add-row">
        <input id="e-tag" className="grow" list="tag-options" placeholder="Escribe una etiqueta (nueva o existente)"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        <datalist id="tag-options">
          {free.map((t) => <option key={t.id} value={t.name} />)}
        </datalist>
        <button type="button" className="ghost" onClick={add} disabled={!text.trim()}>Añadir</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
