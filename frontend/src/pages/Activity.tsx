import { useEffect, useState } from "react";
import { ActivityEntry, api } from "../api";

// Registro de movimientos: quién cambió qué y cuándo (también los inicios de sesión)
const FIELDS: Record<string, string> = {
  date: "Fecha", description: "Descripción", provider: "Proveedor", invoice_number: "Nº factura",
  period_start: "Periodo desde", period_end: "Periodo hasta", category: "Categoría", notes: "Notas",
  reviewed: "Revisado", importe: "Importe", name: "Nombre", color: "Color", kind: "Tipo", value: "Valor",
  source: "Origen", status: "Estado", document: "PDF",
};
const PAGE = 50;

const when = (iso: string | null) =>
  iso ? new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : String(v));

export default function Activity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [user, setUser] = useState("");
  const [more, setMore] = useState(false);

  const load = async (before?: number) => {
    const page = await api.activity({ limit: PAGE, before, user: user || undefined });
    setEntries((list) => (before ? [...list, ...page] : page));
    setMore(page.length === PAGE);
  };
  useEffect(() => { load(); }, [user]);
  useEffect(() => { api.activityUsers().then(setUsers); }, []);

  return (
    <div className="stack">
      <div className="filters">
        <label>
          Usuario
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Todos</option>
            {users.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <section className="card">
        <h2>Actividad</h2>
        <p className="muted small section-sub">
          Cada cambio en los datos (altas, ediciones, borrados, importaciones, etiquetas…) y cada inicio de sesión,
          con quién lo hizo. Pulsa una línea para ver el detalle.
        </p>
        <ul className="activity-list">
          {entries.map((a) => (
            <li key={a.id}>
              <details>
                <summary>
                  <span className="nowrap muted small">{when(a.at)}</span>
                  <span className="strong">{a.user}</span>
                  <span className={a.action.includes("fallido") ? "error" : ""}>{a.action}</span>
                  <span className="muted small grow">{a.summary}</span>
                </summary>
                <div className="activity-detail small">
                  {a.ip && <div className="muted">Desde {a.ip}</div>}
                  {a.details.length === 0 && <div className="muted">Sin cambios de datos.</div>}
                  <ul>
                    {a.details.map((d, i) => (
                      <li key={i}>
                        <span className="strong">{d.op}</span> de {d.entity}
                        {d.count && d.count > 1 ? ` (${d.count}, ${d.label})` : `: ${d.label}`}
                        {d.changes && (
                          <ul>
                            {Object.entries(d.changes).map(([field, [from, to]]) => (
                              <li key={field}>{FIELDS[field] ?? field}: {show(from)} → <strong>{show(to)}</strong></li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          ))}
          {entries.length === 0 && <li className="muted">Aún no hay movimientos registrados.</li>}
        </ul>
        {more && <button type="button" className="ghost" onClick={() => load(entries.at(-1)?.id)}>Ver más</button>}
      </section>
    </div>
  );
}
