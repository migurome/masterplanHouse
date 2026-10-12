import { useEffect, useState } from "react";
import { date } from "../format";
import { APP_VERSION, VERSIONS } from "../versions";

export default function Versions() {
  const [server, setServer] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((d) => setServer(d.version ?? null)).catch(() => setServer(null));
  }, []);

  return (
    <div className="stack">
      <section className="card">
        <h2>Versión {APP_VERSION}</h2>
        <p className="muted small section-sub">
          Web {APP_VERSION}{server && ` · servidor ${server}`}
        </p>
        {server && server !== APP_VERSION && (
          <p className="notice small">
            La web y el servidor no tienen la misma versión: recarga la página (Ctrl+F5) o reinicia el servidor.
          </p>
        )}
      </section>

      <ol className="versions">
        {VERSIONS.map((v, i) => (
          <li key={v.version} className="card">
            <div className="version-head">
              <span className={`version-tag${i === 0 ? " current" : ""}`}>{v.version}</span>
              <h3>{v.title}</h3>
              <span className="muted small push-right">{date(v.date)}</span>
            </div>
            <ul>
              {v.changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
