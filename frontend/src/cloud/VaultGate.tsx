/** Abre la clave de datos con la frase secreta (o la crea la primera vez). Sin ella los datos son ilegibles. */
import { ReactNode, useEffect, useState } from "react";
import { KeySlot, normalizeRecoveryCode, passphraseProblem } from "../vault/crypto";
import { Panel, useBusy } from "./Access";
import { changeMyPassphrase, createHouseVault, loadSlots, Member, recoverWithCode, Slots, unlock } from "./slots";

type Mode = "unlock" | "create" | "recover" | "replace-temporary";

/** Casilla para la frase secreta: el navegador no la rellena con contraseñas guardadas y se puede mostrar. */
export function SecretInput({ label, value, onChange, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label>{label}
      <span className="secret-row">
        <input type="text" className={show ? "" : "secret-field"} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true"
          autoFocus={autoFocus} required />
        <button type="button" className="ghost" onClick={() => setShow(!show)}>{show ? "Ocultar" : "Mostrar"}</button>
      </span>
    </label>
  );
}

export function NewPassphrase({ value, repeat, onChange, onRepeat, label = "Frase secreta" }: {
  value: string; repeat: string; onChange: (v: string) => void; onRepeat: (v: string) => void; label?: string;
}) {
  const issue = value ? passphraseProblem(value) : null;
  return (
    <>
      <SecretInput label={label} value={value} onChange={onChange} />
      {issue && <p className="muted small">{issue}</p>}
      <SecretInput label="Repítela" value={repeat} onChange={onRepeat} />
    </>
  );
}

function checkNew(pass: string, repeat: string) {
  const issue = passphraseProblem(pass);
  if (issue) throw new Error(issue);
  if (pass !== repeat) throw new Error("Las dos frases no coinciden.");
}

export default function VaultGate({ me, onSignOut, children }: {
  me: Member; onSignOut: () => void; children: (key: CryptoKey, lock: () => void) => ReactNode;
}) {
  const [slots, setSlots] = useState<Slots | null>(null);
  const [mode, setMode] = useState<Mode>("unlock");
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null); // se enseña una sola vez al crear
  const [saved, setSaved] = useState(false);
  const [pass, setPass] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [temporary, setTemporary] = useState("");
  const { busy, error, run } = useBusy();

  const load = run(async () => {
    const s = await loadSlots(me.user_id);
    setSlots(s);
    setMode(s.mine ? "unlock" : s.recovery ? "recover" : "create");
  });
  useEffect(() => { load(); }, [me.user_id]);

  const reset = () => { setPass(""); setRepeat(""); setCode(""); };
  const lock = () => { setKey(null); reset(); load(); };

  if (key && !recoveryCode) return <>{children(key, lock)}</>;
  if (!slots) return <Panel title="Abriendo…">{error && <p className="error">{error}</p>}</Panel>;

  if (recoveryCode) {
    return (
      <Panel title="Tu código de recuperación">
        <div className="stack">
          <p>Si los dos olvidáis la frase secreta, <strong>este código es la única forma de recuperar los datos</strong>.
            Nadie más lo tiene: ni Supabase ni esta app.</p>
          <p className="recovery-code">{recoveryCode}</p>
          <p className="small muted">Escríbelo en papel y guárdalo en un sitio seguro (con los papeles importantes de casa).
            No lo guardes en el móvil ni en el correo.</p>
          <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Lo he apuntado en papel</label>
          <button disabled={!saved} onClick={() => setRecoveryCode(null)}>Continuar</button>
        </div>
      </Panel>
    );
  }

  const submit = run(async () => {
    if (mode === "unlock") {
      const k = await unlock(slots.mine as KeySlot, pass);
      if (slots.mine?.temporary) { setTemporary(pass); reset(); setMode("replace-temporary"); return; }
      setKey(k);
    } else if (mode === "create") {
      checkNew(pass, repeat);
      const vault = await createHouseVault(me, pass);
      setRecoveryCode(vault.recoveryCode);
      setKey(vault.key);
    } else if (mode === "recover") {
      checkNew(pass, repeat);
      setKey(await recoverWithCode(me, slots.recovery as KeySlot, normalizeRecoveryCode(code), pass));
    } else {
      checkNew(pass, repeat);
      setKey(await changeMyPassphrase(me, slots.mine as KeySlot, temporary, pass));
    }
    reset();
  });

  const titles: Record<Mode, string> = {
    unlock: "Abre los datos",
    create: "Crea la frase secreta",
    recover: slots.mine ? "Recuperar con el código" : "Aún no tienes acceso a los datos",
    "replace-temporary": "Cambia la frase provisional",
  };

  return (
    <Panel title={titles[mode]}>
      <form className="stack" onSubmit={submit}>
        {mode === "unlock" && (
          <>
            <p className="small muted">Hola, {me.name}. Los datos están cifrados: escribe tu frase secreta para verlos.</p>
            <SecretInput label="Frase secreta" value={pass} onChange={setPass} autoFocus />
          </>
        )}
        {mode === "create" && (
          <>
            <p className="small">Es la primera vez. La frase secreta cifra todos los datos en tu navegador antes de subirlos:
              <strong> nadie puede leerlos sin ella</strong>, tampoco Supabase. Usa 4 o 5 palabras sueltas que recuerdes
              (p. ej. «tortilla nube bici granate») y <strong>que no sea la contraseña de entrar</strong>.
              Da igual mayúsculas o espacios de más.</p>
            <NewPassphrase value={pass} repeat={repeat} onChange={setPass} onRepeat={setRepeat} />
          </>
        )}
        {mode === "recover" && (
          <>
            {!slots.mine && <p className="small">Pide a quien ya entra que te dé acceso desde la página de la nube (te dirá una frase provisional),
              o escribe el código de recuperación de papel.</p>}
            <label>Código de recuperación<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
            <NewPassphrase value={pass} repeat={repeat} onChange={setPass} onRepeat={setRepeat} label="Tu frase secreta nueva" />
          </>
        )}
        {mode === "replace-temporary" && (
          <>
            <p className="small">Te han dado acceso con una frase provisional. Elige ahora la tuya: solo la sabrás tú.</p>
            <NewPassphrase value={pass} repeat={repeat} onChange={setPass} onRepeat={setRepeat} label="Tu frase secreta" />
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Un momento…" : mode === "unlock" ? "Abrir" : "Guardar"}</button>
        {mode === "unlock" && <button type="button" className="link-button" onClick={() => { reset(); setMode("recover"); }}>He olvidado la frase</button>}
        {mode === "recover" && slots.mine && <button type="button" className="link-button" onClick={() => { reset(); setMode("unlock"); }}>Volver</button>}
        <button type="button" className="link-button" onClick={onSignOut}>Salir</button>
      </form>
    </Panel>
  );
}
