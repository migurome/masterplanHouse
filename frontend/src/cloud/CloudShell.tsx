/** La web completa sobre la nube: arranca el servidor del navegador y enseña las pestañas de siempre. */
import { useEffect, useRef, useState } from "react";
import { HashRouter } from "react-router-dom";
import App from "../App";
import { Panel } from "./Access";
import AccessCard from "./AccessCard";
import { Runtime, startCloud } from "./runtime";
import type { Member } from "./slots";

const SYNC_EVERY = 60_000;

export default function CloudShell({ me, dataKey, onLock, onSignOut }: {
  me: Member; dataKey: CryptoKey; onLock: () => void; onSignOut: () => void;
}) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [remote, setRemote] = useState(0); // cambios de otra persona aún no vistos
  const [generation, setGeneration] = useState(0); // al subirlo se vuelven a cargar las pestañas
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // en desarrollo React monta dos veces
    started.current = true;
    let rt: Runtime | null = null;
    startCloud(me, dataKey, onSignOut).then((r) => {
      rt = r;
      r.progress(setProgress);
      setRuntime(r);
    }).catch((err) => setError((err as Error).message));
    return () => rt?.stop();
  }, []);

  useEffect(() => {
    if (!runtime) return;
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      runtime.sync().then((n) => { if (n) setRemote((x) => x + n); }).catch(() => {});
    };
    const timer = window.setInterval(sync, SYNC_EVERY);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [runtime]);

  if (error) {
    return (
      <Panel title="No se han podido abrir los datos">
        <p className="error">{error}</p>
        <button onClick={() => window.location.reload()}>Reintentar</button>
      </Panel>
    );
  }
  if (!runtime) return <Panel title="Abriendo…"><p className="muted">Descargando y descifrando los datos en este navegador…</p></Panel>;

  const lock = () => { runtime.stop(); onLock(); };
  const banner = (
    <>
      {remote > 0 && (
        <div className="notice cloud-banner">
          Otra persona ha cambiado {remote} {remote === 1 ? "dato" : "datos"}.{" "}
          <button className="link-button" onClick={() => { setRemote(0); setGeneration((g) => g + 1); }}>Actualizar</button>
        </div>
      )}
      {progress && <div className="cloud-progress" role="status">{progress}</div>}
    </>
  );

  return (
    <HashRouter>
      <App key={generation} cloud={{ onLock: lock, banner, settingsExtra: <AccessCard me={me} /> }} />
    </HashRouter>
  );
}
