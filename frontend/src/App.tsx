import { ReactNode, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, setUnauthorizedHandler } from "./api";
import { moveNav, NavItem, orderNav } from "./nav";
import Dashboard from "./pages/Dashboard";
import Expenses from "./pages/Expenses";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import Import from "./pages/Import";
import Versions from "./pages/Versions";
import Compare from "./pages/Compare";
import Car from "./pages/Car";
import Savings from "./pages/Savings";
import Review from "./pages/Review";
import Activity from "./pages/Activity";

const NAV_MIME = "application/x-gastos-nav";

/** En la nube: gestión del acceso en Ajustes, botón para bloquear y avisos (cambios de otra persona…). */
export interface CloudProps { settingsExtra?: ReactNode; onLock?: () => void; banner?: ReactNode }

export default function App({ demo = false, cloud }: { demo?: boolean; cloud?: CloudProps }) {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [toReview, setToReview] = useState<number | null>(null);
  const [nav, setNav] = useState<NavItem[]>(orderNav(undefined));
  const [dragOver, setDragOver] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then((u) => setUser(u.username)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    if (!user) return;
    api.prefs().then((p) => setNav(orderNav(p.nav))).catch(() => {});
  }, [user]);
  // El contador de Revisar se refresca al cambiar de pestaña (puede haber cambiado algo)
  useEffect(() => {
    if (user) api.review().then((r) => setToReview(r.total)).catch(() => {});
  }, [user, location.pathname]);

  if (user === undefined) return null;
  if (user === null) return <Login onLogin={setUser} />;

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };
  const saveNav = (items: NavItem[]) => {
    setNav(items);
    api.savePrefs({ nav: items.map((i) => i.path) }).catch(() => {});
  };

  return (
    <div className="layout">
      {cloud?.banner}
      {demo && <div className="demo-banner">Demo con datos de ejemplo. Los PDF que subas no se analizan de verdad y nada se guarda.</div>}
      <header className="topbar">
        <span className="brand">Gastos de casa</span>
        <nav aria-label="Pestañas (arrástralas para cambiar el orden)">
          {nav.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/"} draggable
              className={({ isActive }) => [isActive ? "active" : "", dragOver === item.path ? "nav-drop" : ""].join(" ")}
              title="Arrastra para cambiar el orden"
              onDragStart={(e) => { e.dataTransfer.setData(NAV_MIME, item.path); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(NAV_MIME)) return;
                e.preventDefault();
                setDragOver(item.path);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const from = e.dataTransfer.getData(NAV_MIME);
                if (from && from !== item.path) saveNav(moveNav(nav, from, item.path));
              }}
              onDragEnd={() => setDragOver(null)}>
              {item.label}
              {item.path === "/revisar" && !!toReview && <span className="nav-count" aria-label={`${toReview} pendientes`}>{toReview}</span>}
            </NavLink>
          ))}
        </nav>
        {cloud?.onLock && <button className="ghost" onClick={cloud.onLock} title="Olvida la clave en este navegador: para volver hará falta la frase">Bloquear</button>}
        <button className="ghost" onClick={logout} title={`Sesión de ${user}`}>Salir ({user})</button>
      </header>
      <main className={location.pathname === "/gastos" ? "wide" : undefined}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/comparar" element={<Compare />} />
          <Route path="/coche" element={<Car />} />
          <Route path="/ahorro" element={<Savings />} />
          <Route path="/gastos" element={<Expenses />} />
          <Route path="/revisar" element={<Review onChange={setToReview} />} />
          <Route path="/importar" element={<Import />} />
          <Route path="/subir" element={<Navigate to="/importar?tipo=pdf" replace />} />
          <Route path="/actividad" element={<Activity />} />
          <Route path="/ajustes" element={<Settings nav={nav} onNav={saveNav} extra={cloud?.settingsExtra} />} />
          <Route path="/versiones" element={<Versions />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
