import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Income, SavingsMonth } from "../api";
import ConfirmButton from "../components/ConfirmButton";
import { expensesLink } from "../drill";
import { date, money, moneyShort, MONTHS } from "../format";

// Capacidad de ahorro de la unidad familiar: ingresos (aportaciones, nóminas, transferencias recibidas…)
// menos gastos, por mes y por año.

const INCOME_COLOR = "#6cc39b";
const EXPENSE_COLOR = "#e07f7f";
const pctFmt = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 });
const rate = (inc: number, exp: number) => (inc > 0 ? pctFmt.format((inc - exp) / inc) : "—");

export default function Savings() {
  const [rows, setRows] = useState<SavingsMonth[] | null>(null);
  const navigate = useNavigate();
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [onlyWithIncome, setOnlyWithIncome] = useState(true);

  const load = () => api.statsSavings().then((r) => {
    setRows(r);
    if (year === null && r.length) {
      const withIncome = r.filter((m) => m.income > 0).map((m) => m.year);
      setYear(Math.max(...(withIncome.length ? withIncome : r.map((m) => m.year))));
    }
  });
  useEffect(() => { load(); api.incomeKinds().then(setKinds); }, []);
  useEffect(() => { if (year !== null) api.incomes({ year }).then(setIncomes); }, [year, rows]);

  const years = useMemo(() => [...new Set(rows?.map((r) => r.year) ?? [])].sort(), [rows]);
  const perYear = useMemo(() => years.map((y) => {
    const ms = (rows ?? []).filter((r) => r.year === y);
    const counted = ms.filter((m) => !onlyWithIncome || m.income > 0);
    const income = counted.reduce((s, m) => s + m.income, 0);
    const expense = counted.reduce((s, m) => s + m.expense, 0);
    return { year: y, income, expense, saving: income - expense, months: counted.length, monthsWithIncome: ms.filter((m) => m.income > 0).length };
  }), [rows, years, onlyWithIncome]);

  if (!rows) return <p className="muted">Cargando…</p>;
  if (!rows.some((r) => r.income > 0)) {
    return (
      <div className="stack">
        <section className="card">
          <h2>Ahorro</h2>
          <p>
            Aún no hay ingresos. Impórtalos desde <Link to="/importar">Importar Excel</Link> (las transferencias y
            aportaciones que entran en la cuenta) o añádelos a mano aquí abajo.
          </p>
        </section>
        <IncomeForm kinds={kinds} onSaved={load} />
      </div>
    );
  }

  const months = MONTHS.map((label, i) => {
    const r = rows.find((x) => x.year === year && x.month === i + 1);
    const income = r?.income ?? 0;
    const expense = r?.expense ?? 0;
    return { label, month: i + 1, income, expense, saving: income - expense, hasIncome: income > 0 };
  });
  const cur = perYear.find((p) => p.year === year);
  const counted = months.filter((m) => !onlyWithIncome || m.hasIncome);
  const best = [...counted].filter((m) => m.hasIncome).sort((a, b) => b.saving - a.saving)[0];
  const worst = [...counted].filter((m) => m.hasIncome).sort((a, b) => a.saving - b.saving)[0];
  const byKind = new Map<string, number>();
  for (const i of incomes) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + i.amount);
  const monthsWithout = months.filter((m) => !m.hasIncome && m.expense > 0).map((m) => m.label);

  return (
    <div className="stack">
      <div className="filters">
        <label>
          Año
          <select value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyWithIncome} onChange={(e) => setOnlyWithIncome(e.target.checked)} />
          Contar solo los meses con ingresos registrados
        </label>
      </div>

      {cur && (
        <div className="tiles">
          <div className="tile card">
            <span className="tile-label">Ingresos {year}</span>
            <span className="tile-value income">{money(cur.income)}</span>
            <span className="tile-sub">{cur.monthsWithIncome} meses con ingresos</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Gastos {year}</span>
            <span className="tile-value">{money(cur.expense)}</span>
            <span className="tile-sub">{onlyWithIncome ? `de esos ${cur.months} meses` : "todo el año"}</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Ahorro {year}</span>
            <span className={`tile-value ${cur.saving >= 0 ? "income" : "error"}`}>{money(cur.saving)}</span>
            <span className="tile-sub">tasa de ahorro {rate(cur.income, cur.expense)}</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Capacidad de ahorro</span>
            <span className={`tile-value ${cur.saving >= 0 ? "income" : "error"}`}>{money(cur.months ? cur.saving / cur.months : 0)}</span>
            <span className="tile-sub">al mes de media</span>
          </div>
        </div>
      )}

      <section className="card">
        <h2>Conclusiones {year}</h2>
        <ul className="savings-notes">
          {cur && cur.income > 0 && (
            <li>
              De cada 100 € que entran, se gastan {Math.round((cur.expense / cur.income) * 100)} € y se ahorran{" "}
              {Math.max(0, Math.round((cur.saving / cur.income) * 100))} €
              {cur.saving < 0 && " (los gastos superan a los ingresos)"}.
            </li>
          )}
          {best && <li>Mejor mes: {best.label}, con {money(best.saving)} de ahorro.</li>}
          {worst && worst !== best && <li>Peor mes: {worst.label}, con {money(worst.saving)}.</li>}
          {perYear.length > 1 && (
            <li>
              Por años (meses con ingresos):{" "}
              {perYear.filter((p) => p.income > 0).map((p) => `${p.year}: ${money(p.months ? p.saving / p.months : 0)}/mes`).join(" · ")}.
            </li>
          )}
          {monthsWithout.length > 0 && (
            <li className="warn-text">
              {monthsWithout.join(", ")} no tienen ingresos registrados
              {onlyWithIncome ? ", así que no se cuentan" : ": su ahorro sale negativo"}. Importa el Excel de esos meses o añade los ingresos a mano.
            </li>
          )}
        </ul>
      </section>

      <section className="card">
        <h2>Ingresos y gastos por mes {year}</h2>
        <p className="muted small chart-hint">Pulsa una barra de gastos para ver los gastos del mes.</p>
        <ResponsiveContainer width="100%" height={280} className="drill-chart">
          <BarChart data={months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" stroke="var(--axis)" tickLine={false} interval={0} tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip cursor={{ fill: "var(--hover)" }} content={<MonthTooltip />} />
            <Legend wrapperStyle={{ fontSize: 13 }} iconType="circle" iconSize={10}
              formatter={(v: string) => <span style={{ color: "var(--text-2)" }}>{v}</span>} />
            <Bar dataKey="income" name="Ingresos" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Bar dataKey="expense" name="Gastos" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={26}
              onClick={(d: { payload?: { month: number } }) => year && d.payload && navigate(expensesLink({ year, month: d.payload.month }))} />
          </BarChart>
        </ResponsiveContainer>
        <h3 className="subhead">Ahorro de cada mes</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" stroke="var(--axis)" tickLine={false} interval={0} tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis tickFormatter={moneyShort} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: "var(--hover)" }} content={<MonthTooltip />} />
            <Bar dataKey="saving" name="Ahorro" maxBarSize={30} radius={[4, 4, 4, 4]}>
              {months.map((m) => (
                <Cell key={m.label} fill={!m.hasIncome ? "var(--axis)" : m.saving >= 0 ? INCOME_COLOR : EXPENSE_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="muted small">En gris, los meses sin ingresos registrados.</p>
      </section>

      <section className="card">
        <h2>Por año</h2>
        <div className="table-scroll compare-table">
          <table>
            <thead>
              <tr><th>Año</th><th className="num">Ingresos</th><th className="num">Gastos</th><th className="num">Ahorro</th>
                <th className="num">Tasa</th><th className="num">Al mes</th><th className="num">Meses</th></tr>
            </thead>
            <tbody>
              {perYear.map((p) => (
                <tr key={p.year} className={p.year === year ? "selected" : ""} onClick={() => setYear(p.year)}>
                  <td>{p.year}</td>
                  <td className="num">{money(p.income)}</td>
                  <td className="num">{money(p.expense)}</td>
                  <td className={`num ${p.saving >= 0 ? "income" : "error"}`}>{money(p.saving)}</td>
                  <td className="num">{rate(p.income, p.expense)}</td>
                  <td className="num">{money(p.months ? p.saving / p.months : 0)}</td>
                  <td className="num">{p.months}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Ingresos {year}</h2>
        {byKind.size > 0 && (
          <p className="tl-legend small muted">
            {[...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}>{k}: <strong>{money(v)}</strong></span>)}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>
              {incomes.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap">{date(i.date)}</td>
                  <td>{i.description}<div className="muted small">{i.source === "banco" ? "Banco" : "Manual"}</div></td>
                  <td className="small">{i.kind}</td>
                  <td className="num nowrap income">{money(i.amount)}</td>
                  <td><ConfirmButton label="Borrar" question="¿Borrar este ingreso?" onConfirm={() => api.deleteIncome(i.id).then(load)} /></td>
                </tr>
              ))}
              {incomes.length === 0 && <tr><td colSpan={5} className="muted">No hay ingresos en {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <IncomeForm kinds={kinds} onSaved={load} />
    </div>
  );
}

function MonthTooltip({ active, label, payload }: { active?: boolean; label?: string; payload?: { payload: Record<string, number | boolean> }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const income = Number(r.income), expense = Number(r.expense);
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <div className="row"><span className="swatch" style={{ background: INCOME_COLOR }} /><span>Ingresos</span><span className="num">{money(income)}</span></div>
      <div className="row"><span className="swatch" style={{ background: EXPENSE_COLOR }} /><span>Gastos</span><span className="num">{money(expense)}</span></div>
      <div className="row total"><span /><span>Ahorro</span><span className="num">{r.hasIncome ? money(income - expense) : "sin ingresos"}</span></div>
    </div>
  );
}

function IncomeForm({ kinds, onSaved }: { kinds: string[]; onSaved: () => void }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", description: "", kind: "Nóminas" });
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.createIncome({ date: form.date, amount: Number(form.amount), description: form.description, kind: form.kind, notes: null });
      setForm({ ...form, amount: "", description: "" });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section className="card">
      <h2>Añadir un ingreso a mano</h2>
      <p className="muted small section-sub">
        Para ingresos que no pasan por la cuenta importada (por ejemplo, una nómina que cobra otro miembro de la familia).
        Ojo: si luego esa persona transfiere dinero a esta cuenta, no lo cuentes dos veces.
      </p>
      <form className="filters" onSubmit={submit}>
        <label>Fecha<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>Importe (€)<input type="number" required min="0.01" step="0.01" className="amount-filter" value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label className="grow">Concepto<input value={form.description} placeholder="Nómina de octubre…"
          onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Tipo
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <button>Añadir</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
