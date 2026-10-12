import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ReviewData, ReviewItem, ReviewSection } from "../api";
import { money } from "../format";

// Todo lo pendiente de revisar en un sitio: cada aviso lleva a sus gastos y se puede descartar
const LEVEL_LABEL: Record<string, string> = { alta: "Importante", media: "Revisar", baja: "Sugerencia" };

export default function Review({ onChange }: { onChange?: (total: number) => void }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const load = () => api.review(showDismissed).then((d) => { setData(d); onChange?.(d.total); });
  useEffect(() => { load(); }, [showDismissed]);

  const dismiss = async (keys: string[]) => { await api.reviewDismiss(keys); load(); };
  const restore = async (keys: string[]) => { await api.reviewRestore(keys); load(); };

  if (!data) return <p className="muted">Cargando…</p>;
  const withItems = data.sections.filter((s) => s.items.length > 0);

  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile card">
          <span className="tile-label">Pendiente de revisar</span>
          <span className="tile-value">{data.total}</span>
          <span className="tile-sub">avisos en {withItems.length} apartados</span>
        </div>
        {withItems.map((s) => (
          <a key={s.id} href={`#rev-${s.id}`} className="tile card">
            <span className="tile-label">{s.title}</span>
            <span className="tile-value">{s.items.filter((i) => !i.dismissed).length}</span>
            <span className={`tile-sub level-${s.level}`}>{LEVEL_LABEL[s.level]}</span>
          </a>
        ))}
      </div>

      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
          Mostrar también los descartados ({data.dismissed})
        </label>
        {data.dismissed > 0 && (
          <button type="button" className="ghost push-right" onClick={() => restore([])}>Volver a mostrar todos</button>
        )}
      </div>

      {withItems.length === 0 && (
        <section className="card"><p>Nada pendiente de revisar. 🎉</p></section>
      )}

      {withItems.map((s) => (
        <ReviewBlock key={s.id} section={s} onDismiss={dismiss} onRestore={restore} />
      ))}
    </div>
  );
}

function ReviewBlock({ section: s, onDismiss, onRestore }: {
  section: ReviewSection;
  onDismiss: (keys: string[]) => void;
  onRestore: (keys: string[]) => void;
}) {
  const open = s.items.filter((i) => !i.dismissed);
  return (
    <section className="card review-section" id={`rev-${s.id}`}>
      <div className="table-head">
        <h2>
          {s.title} <span className={`level-pill level-${s.level}`}>{LEVEL_LABEL[s.level]}</span>
        </h2>
        {s.dismissable && open.length > 1 && (
          <button type="button" className="ghost small" onClick={() => onDismiss(open.map((i) => i.key))}>
            Descartar los {open.length}
          </button>
        )}
      </div>
      <p className="muted small section-sub">{s.help}</p>
      <ul className="review-list">
        {s.items.map((i) => (
          <ReviewRow key={i.key} item={i} dismissable={s.dismissable} onDismiss={onDismiss} onRestore={onRestore} />
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ item: i, dismissable, onDismiss, onRestore }: {
  item: ReviewItem;
  dismissable: boolean;
  onDismiss: (keys: string[]) => void;
  onRestore: (keys: string[]) => void;
}) {
  const href = i.expense_ids.length ? `/gastos?ids=${i.expense_ids.join(",")}` : i.link;
  const external = href?.startsWith("/api/");
  return (
    <li className={i.dismissed ? "dismissed" : ""}>
      <div className="grow">
        <div className="strong">{i.title}</div>
        {i.detail && <div className="muted small">{i.detail}</div>}
      </div>
      {i.amount != null && <span className="num nowrap">{money(i.amount)}</span>}
      <span className="review-actions">
        {href && (external
          ? <a href={href} target="_blank" rel="noreferrer">Abrir PDF</a>
          : <Link to={href}>{i.expense_ids.length > 1 ? `Ver los ${i.expense_ids.length}` : "Ver"}</Link>)}
        {dismissable && (i.dismissed
          ? <button type="button" className="link-button" onClick={() => onRestore([i.key])}>Volver a mostrar</button>
          : <button type="button" className="link-button" title="Ya lo he revisado: que no vuelva a salir" onClick={() => onDismiss([i.key])}>Descartar</button>)}
      </span>
    </li>
  );
}

