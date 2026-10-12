"""Administración de Supabase (usa SUPABASE_DB_URL de backend/.env; nunca muestra claves).

    python supabase/admin.py aplicar             # crea o actualiza el esquema (*.sql en orden)
    python supabase/admin.py miembro <nombre> [--email correo]
    python supabase/admin.py estado
    python supabase/admin.py probar              # comprueba la protección (sin dejar rastro en la base)

Ejecútalo con el Python del backend: backend/.venv/Scripts/python supabase/admin.py …
"""

import argparse
import json
import sys
import uuid
from pathlib import Path

import httpx
import psycopg

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent / "backend" / ".env"


def load_env() -> dict[str, str]:
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("SUPABASE_DB_URL"):
        raise SystemExit(f"Falta SUPABASE_DB_URL en {ENV_FILE}")
    return env


def connect(env):
    return psycopg.connect(env["SUPABASE_DB_URL"], sslmode="require", connect_timeout=15)


def mask(email: str) -> str:
    return email[:2] + "•••@" + email.split("@")[-1] if "@" in email else "—"


def aplicar(args, env):
    files = sorted(HERE.glob("*.sql"))
    with connect(env) as conn:
        conn.autocommit = True  # cada archivo lleva su propio begin/commit
        for f in files:
            conn.execute(f.read_text(encoding="utf-8"))
            print(f"OK {f.name}")


def miembro(args, env):
    with connect(env) as conn:
        rows = conn.execute("""
            select u.id, u.email from auth.users u
            where u.email_confirmed_at is not null
              and not exists (select 1 from public.members m where m.user_id = u.id)
        """).fetchall()
        if args.email:
            rows = [r for r in rows if r[1].lower() == args.email.lower()]
        if len(rows) != 1:
            found = ", ".join(mask(r[1]) for r in rows) or "ninguno"
            raise SystemExit(f"Hay {len(rows)} usuarios confirmados sin casa ({found}). Indica cuál con --email.")
        user_id, email = rows[0]
        conn.execute("insert into public.members (user_id, name) values (%s, %s)", (user_id, args.nombre))
        print(f"OK {mask(email)} es miembro de la casa como '{args.nombre}'")


def enlace(args, env):
    """Enlace para crear contraseña nueva sin pasar por el correo (límite de envíos). Se abre en el navegador, no se muestra."""
    import webbrowser
    with connect(env) as conn:
        row = conn.execute("select u.email from public.members m join auth.users u on u.id = m.user_id where m.name = %s",
                           (args.nombre,)).fetchone()
    if not row:
        raise SystemExit(f"No hay ningún miembro llamado '{args.nombre}'")
    base, sec = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SECRET_KEY"]
    r = httpx.post(f"{base}/auth/v1/admin/generate_link", timeout=20,
                   headers={"apikey": sec, "Authorization": f"Bearer {sec}"},
                   json={"type": "recovery", "email": row[0], "redirect_to": args.destino})
    if r.status_code != 200:
        raise SystemExit(f"Supabase respondió {r.status_code}: {r.text[:200]}")
    link = r.json().get("action_link") or r.json().get("properties", {}).get("action_link")
    webbrowser.open(link)
    print(f"OK enlace abierto en el navegador para {mask(row[0])} (un solo uso)")


def contrasena(args, env):
    """Pone la contraseña de entrada de un miembro (se teclea aquí, sin correo ni enlaces)."""
    import getpass
    with connect(env) as conn:
        row = conn.execute("select m.user_id, u.email from public.members m join auth.users u on u.id = m.user_id "
                           "where m.name = %s", (args.nombre,)).fetchone()
    if not row:
        raise SystemExit(f"No hay ningún miembro llamado '{args.nombre}'")
    password = getpass.getpass(f"Contraseña nueva para {mask(row[1])} (no se ve al escribir): ")
    if len(password) < 12:
        raise SystemExit("Usa al menos 12 caracteres")
    if password != getpass.getpass("Repítela: "):
        raise SystemExit("No coinciden")
    base, sec = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SECRET_KEY"]
    r = httpx.put(f"{base}/auth/v1/admin/users/{row[0]}", timeout=20,
                  headers={"apikey": sec, "Authorization": f"Bearer {sec}"}, json={"password": password})
    if r.status_code != 200:
        raise SystemExit(f"Supabase respondió {r.status_code}: {r.text[:200]}")
    print("OK contraseña cambiada. Entra en http://localhost:8000/nube.html con ella.")


def reiniciar(args, env):
    """Borra de la nube los datos, los PDF y las copias de la clave (las cuentas y la actividad se quedan)."""
    if not args.si:
        raise SystemExit("Borra TODOS los datos de la nube. Repite con --si para confirmar.")
    base, sec = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SECRET_KEY"]
    h = {"apikey": sec, "Authorization": f"Bearer {sec}"}
    removed = 0
    with httpx.Client(timeout=60, headers=h) as c:
        while True:
            r = c.post(f"{base}/storage/v1/object/list/documentos", json={"prefix": "", "limit": 100})
            names = [f["name"] for f in r.json()]
            if not names:
                break
            c.request("DELETE", f"{base}/storage/v1/object/documentos", json={"prefixes": names}).raise_for_status()
            removed += len(names)
    with connect(env) as conn:
        records = conn.execute("delete from public.records").rowcount
        slots = conn.execute("delete from public.vault_slots").rowcount
    print(f"OK nube vacía: {records} registros, {removed} PDF y {slots} copias de la clave borrados")


def estado(args, env):
    with connect(env) as conn:
        q = lambda sql: conn.execute(sql).fetchall()  # noqa: E731
        for name, rls in q("""select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'public' and c.relkind = 'r' order by 1"""):
            print(f"tabla {name}: protección por filas {'sí' if rls else 'NO'}")
        print("políticas:", ", ".join(f"{t}.{p}" for t, p in q(
            "select tablename, policyname from pg_policies where schemaname in ('public','storage') "
            "and (schemaname = 'public' or policyname like 'documentos_%') order by 1, 2")))
        print("miembros:", [r[0] for r in q("select name from public.members order by 1")])
        print("copias de la clave:", [r[0] for r in q("select name from public.vault_slots order by 1")])
        print("registros:", dict(q("select kind, count(*) from public.records group by 1 order by 1")))
        print("almacén:", q("select id, public, file_size_limit from storage.buckets"))
        print("actividad:", q("select count(*) from public.activity")[0][0], "movimientos")


# ---------- pruebas ----------
class Probe:
    def __init__(self, conn):
        self.conn, self.ok, self.bad = conn, 0, 0

    def check(self, label, sql, params=(), *, as_=None, fails=False, expect=None):
        """Ejecuta sql con el rol/sesión indicados dentro de un punto de guardado y compara el resultado."""
        result, error = None, None
        try:
            with self.conn.transaction():
                # "set local" dura hasta el final de la transacción: cada prueba empieza como administrador
                self.conn.execute("reset role")
                if as_ is not None:
                    role, claims = as_
                    self.conn.execute(f"set local role {role}")
                    self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
                cur = self.conn.execute(sql, params)
                result = cur.fetchall() if cur.description else cur.rowcount
        except psycopg.Error as exc:
            error = type(exc).__name__
        good = (error is not None) if fails else (error is None and (expect is None or expect(result)))
        self.ok += good
        self.bad += not good
        detail = f"error {error}" if error else f"resultado {result}"
        print(f"  {'OK' if good else '!!'}  {label} ({detail})")
        return result


def session(user_id, aal):
    return ("authenticated", {"sub": str(user_id), "role": "authenticated", "aal": aal})


def probar(args, env):
    with connect(env) as conn:
        member = conn.execute("select user_id from public.members order by created_at limit 1").fetchone()
        if not member:
            raise SystemExit("No hay miembros: primero python supabase/admin.py miembro <nombre>")
        me, stranger = member[0], uuid.uuid4()
        anon = ("anon", {"role": "anon"})
        p = Probe(conn)
        print("Sin sesión (clave publicable)")
        p.check("no lee datos", "select count(*) from public.records", as_=anon, fails=True)
        p.check("no lee la clave", "select count(*) from public.vault_slots", as_=anon, fails=True)
        p.check("no escribe", "insert into public.records (kind, data) values ('expense', 'v1.x')", as_=anon, fails=True)
        print("Con sesión pero sin ser de la casa")
        p.check("no ve nada", "select count(*) from public.records", as_=session(stranger, "aal2"), expect=lambda r: r[0][0] == 0)
        p.check("no escribe", "insert into public.records (kind, data) values ('expense', 'v1.x')",
                as_=session(stranger, "aal2"), fails=True)
        print("Miembro sin segundo factor")
        p.check("no ve nada", "select count(*) from public.members", as_=session(me, "aal1"), expect=lambda r: r[0][0] == 0)
        p.check("no escribe", "insert into public.records (kind, data) values ('expense', 'v1.x')",
                as_=session(me, "aal1"), fails=True)
        print("Miembro con segundo factor")
        mine = session(me, "aal2")
        rid = p.check("crea un registro cifrado", "insert into public.records (kind, data) values ('expense', 'v1.prueba') "
                      "returning id, version, updated_by", as_=mine,
                      expect=lambda r: r[0][1] == 1 and r[0][2] == me)
        rid = rid[0][0] if rid else uuid.uuid4()
        p.check("rechaza datos sin cifrar", "insert into public.records (kind, data) values ('expense', '{\"importe\": 3}')",
                as_=mine, fails=True)
        p.check("al editar sube la versión", "update public.records set data = 'v1.otra' where id = %s returning version",
                (rid,), as_=mine, expect=lambda r: r[0][0] == 2)
        p.check("no puede cambiar el tipo", "update public.records set kind = 'income' where id = %s", (rid,), as_=mine, fails=True)
        p.check("no puede falsear el autor", "update public.records set updated_by = gen_random_uuid() where id = %s "
                "returning updated_by", (rid,), as_=mine, expect=lambda r: r[0][0] == me)
        p.check("la actividad lo registra", "select op from public.activity where row_id = %s order by id", (str(rid),),
                as_=mine, expect=lambda r: [x[0] for x in r] == ["alta", "cambio", "cambio"])
        p.check("no puede escribir actividad", "insert into public.activity (op, tbl) values ('x', 'y')", as_=mine, fails=True)
        p.check("no puede borrar actividad", "delete from public.activity", as_=mine, fails=True)
        p.check("no puede editar actividad", "update public.activity set op = 'x'", as_=mine, fails=True)
        p.check("guarda la copia de recuperación", "insert into public.vault_slots (name, slot) values "
                "('recuperacion', '{\"wrapped\":\"a\",\"salt\":\"b\",\"iv\":\"c\"}') "
                "on conflict (name) do update set slot = excluded.slot", as_=mine, expect=lambda n: n == 1)
        p.check("no puede hacerse miembro a otro", "insert into public.members (user_id, name) values (%s, 'intruso')",
                (stranger,), as_=mine, fails=True)
        p.check("el almacén de PDF es privado", "select public from storage.buckets where id = 'documentos'",
                expect=lambda r: r == [(False,)])
        conn.rollback()  # nada de lo anterior queda guardado

    print("Desde internet con la clave publicable")
    base = env["SUPABASE_URL"].rstrip("/")
    h = {"apikey": env["SUPABASE_PUBLISHABLE_KEY"]}
    with httpx.Client(timeout=20) as c:
        for table in ("records", "vault_slots", "members", "activity"):
            r = c.get(f"{base}/rest/v1/{table}?select=*", headers=h)
            good = r.status_code in (401, 403) or (r.status_code == 200 and r.json() == [])
            p.ok += good
            p.bad += not good
            print(f"  {'OK' if good else '!!'}  {table}: {r.status_code} {r.text[:80]}")
        r = c.post(f"{base}/storage/v1/object/list/documentos", headers=h, json={"prefix": ""})
        good = r.status_code >= 400 or r.json() == []
        p.ok += good
        p.bad += not good
        print(f"  {'OK' if good else '!!'}  PDF: {r.status_code} {r.text[:80]}")
    print(f"\n{p.ok} correctas, {p.bad} fallos")
    sys.exit(1 if p.bad else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("aplicar").set_defaults(fn=aplicar)
    m = sub.add_parser("miembro")
    m.add_argument("nombre")
    m.add_argument("--email")
    m.set_defaults(fn=miembro)
    e = sub.add_parser("enlace", help="abre un enlace para crear contraseña nueva (sin correo)")
    e.add_argument("nombre")
    e.add_argument("--destino", default="http://localhost:8000/nube.html")
    e.set_defaults(fn=enlace)
    c = sub.add_parser("contrasena", help="pone la contraseña de entrada de un miembro (se teclea, no se muestra)")
    c.add_argument("nombre")
    c.set_defaults(fn=contrasena)
    r = sub.add_parser("reiniciar", help="borra los datos, PDF y copias de la clave de la nube")
    r.add_argument("--si", action="store_true")
    r.set_defaults(fn=reiniciar)
    sub.add_parser("estado").set_defaults(fn=estado)
    sub.add_parser("probar").set_defaults(fn=probar)
    args = ap.parse_args()
    args.fn(args, load_env())


if __name__ == "__main__":
    main()
