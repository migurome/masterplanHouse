import React from "react";
import ReactDOM from "react-dom/client";
import "../styles.css";
import Access, { Panel } from "./Access";
import { configured } from "./client";
import CloudShell from "./CloudShell";
import VaultGate from "./VaultGate";

function CloudApp() {
  if (!configured) {
    return <Panel title="Falta configurar">Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en frontend/.env.local.</Panel>;
  }
  return (
    <Access>
      {(me, signOut) => (
        <VaultGate me={me} onSignOut={signOut}>
          {(key, lock) => <CloudShell me={me} dataKey={key} onLock={lock} onSignOut={signOut} />}
        </VaultGate>
      )}
    </Access>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CloudApp />
  </React.StrictMode>,
);
