/** Acceso a los datos cifrados: cambiar mi frase y dar acceso a otro miembro con una frase provisional. */
import { useEffect, useState } from "react";
import { useBusy } from "./Access";
import { changeMyPassphrase, grantAccess, loadMembers, loadSlots, Member } from "./slots";
import { SecretInput, NewPassphrase } from "./VaultGate";

export default function AccessCard({ me }: { me: Member }) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { loadMembers().then(setMembers).catch(() => {}); }, []);
  const others = members.filter((m) => m.user_id !== me.user_id);
  const [current, setCurrent] = useState("");
  const [pass, setPass] = useState("");
  const [repeat, setRepeat] = useState("");
  const [who, setWho] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useBusy();

  const mine = async () => {
    const { mine } = await loadSlots(me.user_id);
    if (!mine) throw new Error("No tienes copia de la clave.");
    return mine;
  };
  const check = () => { if (pass !== repeat) throw new Error("Las dos frases no coinciden."); };
  const clear = (msg: string) => { setCurrent(""); setPass(""); setRepeat(""); setDone(msg); };

  const change = run(async () => {
    check();
    await changeMyPassphrase(me, await mine(), current, pass);
    clear("Frase cambiada. La próxima vez usa la nueva.");
  });
  const grant = run(async () => {
    check();
    const other = others.find((m) => m.user_id === who);
    if (!other) throw new Error("Elige a quién.");
    await grantAccess(other, await mine(), current, pass);
    clear(`Hecho. Dile a ${other.name} la frase provisional en persona (no por mensaje): tendrá que cambiarla al entrar.`);
  });

  return (
    <section className="card">
      <h2>Acceso a los datos cifrados</h2>
      <p className="muted small section-sub">Tu frase secreta abre los datos en este navegador. Cámbiala aquí o da acceso a otro miembro de la casa.</p>
      <form className="stack" onSubmit={(e) => e.preventDefault()}>
        <SecretInput label="Tu frase secreta actual" value={current} onChange={setCurrent} />
        <NewPassphrase value={pass} repeat={repeat} onChange={setPass} onRepeat={setRepeat} label="Frase nueva (tuya, o provisional para otro miembro)" />
        <div className="row-tools">
          <button type="button" disabled={busy || !current} onClick={() => change()}>Cambiar mi frase</button>
          {others.length > 0 && (
            <>
              <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Miembro">
                <option value="">Dar acceso a…</option>
                {others.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </select>
              <button type="button" className="ghost" disabled={busy || !current || !who} onClick={() => grant()}>Dar acceso</button>
            </>
          )}
        </div>
        {others.length === 0 && <p className="muted small">Cuando el segundo miembro esté dado de alta podrás darle acceso aquí.</p>}
        {done && <p className="notice">{done}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
