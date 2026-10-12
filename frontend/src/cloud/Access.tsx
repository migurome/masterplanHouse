/** Entrada a la nube: correo + contraseña, segundo factor obligatorio y comprobación de que eres de la casa. */
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { linkError, linkType, problem, supabase } from "./client";
import { Member } from "./slots";

type Stage =
  | { s: "loading" }
  | { s: "signin" }
  | { s: "set-password" }
  | { s: "mfa-enroll" }
  | { s: "mfa-verify"; factorId: string }
  | { s: "not-member" }
  | { s: "ready"; me: Member };

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="login">
      <div className="card cloud-panel">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(problem(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export default function Access({ children }: { children: (me: Member, signOut: () => void) => ReactNode }) {
  const [stage, setStage] = useState<Stage>({ s: "loading" });
  const [mustSetPassword, setMustSetPassword] = useState(linkType === "invite" || linkType === "recovery");

  const refresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return setStage({ s: "signin" });
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const totp = f?.totp.find((x) => x.status === "verified");
      if (totp) return setStage({ s: "mfa-verify", factorId: totp.id }); // con 2FA activo, cambiar la contraseña exige el código antes
      if (!mustSetPassword) return setStage({ s: "mfa-enroll" });
    }
    if (mustSetPassword) return setStage({ s: "set-password" });
    const { data: me } = await supabase.from("members").select("user_id, name").eq("user_id", session.user.id).maybeSingle();
    setStage(me ? { s: "ready", me: me as Member } : { s: "not-member" });
  };

  useEffect(() => {
    // getSession espera a que Supabase lea la sesión del enlace del correo; después se quita de la barra
    refresh().then(() => { if (linkType) history.replaceState(null, "", window.location.pathname); });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setStage({ s: "signin" });
      if (event === "PASSWORD_RECOVERY") setMustSetPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (stage.s !== "loading") refresh(); }, [mustSetPassword]);

  const signOut = () => { supabase.auth.signOut(); };

  switch (stage.s) {
    case "loading": return null;
    case "signin": return <SignIn onDone={refresh} />;
    case "set-password": return <SetPassword invite={linkType === "invite"} onDone={() => setMustSetPassword(false)} />;
    case "mfa-enroll": return <MfaEnroll onDone={refresh} onCancel={signOut} />;
    case "mfa-verify": return <MfaVerify factorId={stage.factorId} onDone={refresh} onCancel={signOut} />;
    case "not-member":
      return (
        <Panel title="Sin acceso">
          <p>Tu cuenta es correcta, pero aún no está dada de alta en la casa. Pide al administrador que te añada.</p>
          <button className="ghost" onClick={signOut}>Salir</button>
        </Panel>
      );
    case "ready": return <>{children(stage.me, signOut)}</>;
  }
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run, setError } = useBusy();

  const signIn = run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    onDone();
  });
  const forgot = run(async () => {
    if (!email) return setError("Escribe tu correo y vuelve a pulsar.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    if (error) throw error;
    setSent(true);
  });

  return (
    <Panel title="Gastos de casa">
      <form className="stack" onSubmit={signIn}>
        {linkError && <p className="error">{linkError}</p>}
        <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error">{error}</p>}
        {sent && <p className="notice">Te hemos enviado un correo con un enlace para crear una contraseña nueva.</p>}
        <button disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <button type="button" className="link-button" onClick={() => forgot()} disabled={busy}>He olvidado mi contraseña</button>
      </form>
    </Panel>
  );
}

function SetPassword({ invite, onDone }: { invite: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, run } = useBusy();
  const save = run(async () => {
    if (password.length < 12) throw new Error("Usa al menos 12 caracteres.");
    if (password !== repeat) throw new Error("Las contraseñas no coinciden.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    onDone();
  });
  return (
    <Panel title={invite ? "Bienvenido: crea tu contraseña" : "Contraseña nueva"}>
      <form className="stack" onSubmit={save}>
        <p className="muted small">Es la contraseña para entrar. Más adelante crearás también una frase secreta, distinta, que es la que abre los datos.</p>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required /></label>
        <label>Repítela<input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required /></label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>Guardar</button>
      </form>
    </Panel>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>Código de 6 cifras
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" autoFocus required />
    </label>
  );
}

function MfaEnroll({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, run } = useBusy();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // en desarrollo React monta dos veces: no crear dos factores
    started.current = true;
    run(async () => {
      // Quita intentos anteriores sin terminar
      const { data: f } = await supabase.auth.mfa.listFactors();
      for (const old of f?.all.filter((x) => x.status !== "verified") ?? []) await supabase.auth.mfa.unenroll({ factorId: old.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Gastos ${new Date().toISOString()}` });
      if (error) throw error;
      if (data.type !== "totp") throw new Error("Tipo de segundo factor inesperado");
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  const verify = run(async () => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor!.id, code });
    if (error) throw error;
    onDone();
  });

  return (
    <Panel title="Activa el segundo factor">
      <form className="stack" onSubmit={verify}>
        <p className="small">Es obligatorio. Abre una app de códigos (Google Authenticator, Microsoft Authenticator, 1Password…),
          escanea el código y escribe las 6 cifras que te muestre.</p>
        {factor && (
          <>
            <img className="qr" src={factor.qr} alt="Código QR para la app de códigos" />
            <details className="small"><summary>No puedo escanear</summary>Escribe esta clave en la app: <code className="secret">{factor.secret}</code></details>
            <CodeInput value={code} onChange={setCode} />
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button disabled={busy || !factor || code.length !== 6}>Activar</button>
        <button type="button" className="link-button" onClick={onCancel}>Salir</button>
      </form>
    </Panel>
  );
}

function MfaVerify({ factorId, onDone, onCancel }: { factorId: string; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const { busy, error, run } = useBusy();
  const verify = run(async () => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
    onDone();
  });
  return (
    <Panel title="Segundo factor">
      <form className="stack" onSubmit={verify}>
        <p className="small">Escribe el código que muestra tu app de códigos.</p>
        <CodeInput value={code} onChange={setCode} />
        {error && <p className="error">{error}</p>}
        <button disabled={busy || code.length !== 6}>Entrar</button>
        <button type="button" className="link-button" onClick={onCancel}>Salir</button>
      </form>
    </Panel>
  );
}

export { useBusy };
