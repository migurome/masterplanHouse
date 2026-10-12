import { useEffect, useState } from "react";
import { api, BankImportBatch } from "../api";
import { date, money } from "../format";
import ConfirmButton from "./ConfirmButton";

// Historial de importaciones del Excel del banco, para deshacer una sesión entera (todo lo importado
// desde un mismo análisis del Excel) o solo un bloque.
const at = (b: BankImportBatch) => Date.parse(`${b.created_at}Z`); // el servidor guarda la hora en UTC
const time = (t: number) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const day = (t: number) => new Date(t).toLocaleDateString("es-ES");

interface Session {
  batches: BankImportBatch[]; start: number; end: number; count: number; total: number; incomes: number;
  incomeTotal: number; from: string; to: string;
}

function toSessions(batches: BankImportBatch[]): Session[] {
  const bySession = new Map<string, Session>();
  for (const b of [...batches].sort((x, y) => at(x) - at(y))) {
    const last = bySession.get(b.session);
    if (last) {
      last.batches.push(b);
      last.end = at(b);
      last.count += b.count;
      last.total += b.total;
      last.incomes += b.incomes;
      last.incomeTotal += b.income_total;
      if (b.date_from < last.from) last.from = b.date_from;
      if (b.date_to > last.to) last.to = b.date_to;
    } else {
      bySession.set(b.session, {
        batches: [b], start: at(b), end: at(b), count: b.count, total: b.total, incomes: b.incomes,
        incomeTotal: b.income_total, from: b.date_from, to: b.date_to,
      });
    }
  }
  return [...bySession.values()].sort((x, y) => y.start - x.start);
}

export default function ImportHistory({ refresh, onUndone }: { refresh: number; onUndone: (deleted: number) => void }) {
  const [batches, setBatches] = useState<BankImportBatch[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.bankImports().then(setBatches);
  useEffect(() => { load(); }, [refresh]);

  const undo = async (ids: string[]) => {
    setBusy(true);
    try {
      const r = await api.bankUndo(ids);
      onUndone(r.deleted);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!batches || batches.length === 0) return null;
  const sessions = toSessions(batches);

  return (
    <section className="card">
      <h2>Importaciones hechas</h2>
      <p className="muted small section-sub">
        Deshacer borra los gastos que creó esa importación; sus movimientos vuelven a poder importarse.
      </p>
      <ul className="imports">
        {sessions.map((s) => {
          const big = s.batches.filter((b) => b.count + b.incomes > 1);
          const singles = s.batches.filter((b) => b.count + b.incomes === 1);
          return (
            <li key={s.batches[0].batch}>
              <div className="import-row">
                <div>
                  <div className="strong">
                    {day(s.start)} · {time(s.start)}{s.end !== s.start && `–${time(s.end)}`} · {s.count} gastos · {money(s.total)}
                    {s.incomes > 0 && ` · ${s.incomes} ingresos · ${money(s.incomeTotal)}`}
                  </div>
                  <div className="muted small">Movimientos del {date(s.from)} al {date(s.to)}</div>
                </div>
                <ConfirmButton label="Deshacer todo" question={`¿Borrar estos ${s.count + s.incomes} movimientos?`} confirmLabel="Sí, deshacer"
                  onConfirm={() => undo(s.batches.map((b) => b.batch))} />
              </div>
              {s.batches.length > 1 && (
                <details>
                  <summary className="small">Ver los {s.batches.length} bloques</summary>
                  <ul>
                    {big.map((b) => (
                      <li key={b.batch} className="import-row small">
                        <span>
                          {time(at(b))} · importación de {b.count} seleccionados · {money(b.total)} ·
                          {" "}del {date(b.date_from)} al {date(b.date_to)}
                        </span>
                        <ConfirmButton label="Deshacer" question={`¿Borrar ${b.count} gastos?`} confirmLabel="Sí, deshacer"
                          onConfirm={() => undo([b.batch])} />
                      </li>
                    ))}
                    {singles.length > 0 && (
                      <li className="import-row small">
                        <span>
                          {singles.length} movimientos importados con OK · {money(singles.reduce((t, b) => t + b.total, 0))}
                        </span>
                        <ConfirmButton label="Deshacer" question={`¿Borrar ${singles.length} gastos?`} confirmLabel="Sí, deshacer"
                          onConfirm={() => undo(singles.map((b) => b.batch))} />
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {busy && <p className="muted small">Deshaciendo…</p>}
    </section>
  );
}
