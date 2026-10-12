# Gastos de casa

Web para llevar los gastos e ingresos de una casa: facturas en PDF (se leen en el navegador, sin servicios
externos), movimientos del Excel del banco, gastos a mano, gráficas por año, mes y categoría, coche, ahorro y una
pestaña *Revisar* con lo que conviene mirar a mano.

Todo se cifra **en el navegador** antes de guardarse en Supabase: la base de datos solo contiene bloques ilegibles.
No hay servidor propio; la web es estática (GitHub Pages).

- **Web:** React + Vite + Recharts (`frontend/`). Página de entrada: `frontend/nube.html`.
- **"Servidor" en el navegador:** `frontend/src/cloud/server/` responde a las peticiones `/api/*` de la web con
  los datos descifrados en memoria (estadísticas, búsquedas, Revisar, importación del banco, copias de seguridad).
- **Lectura de PDF:** pdf.js + extractores por proveedor (`frontend/src/cloud/pdf/parsers.ts`).
- **Supabase:** autenticación, tablas con datos cifrados y PDF cifrados (`supabase/001_esquema.sql`).

## Seguridad

- **Acceso:** correo + contraseña de Supabase Auth y segundo factor (TOTP) obligatorio. Las políticas de filas
  (RLS) exigen sesión con 2FA (`aal2`) y ser miembro de la casa (`members`).
- **Cifrado de extremo a extremo** (`frontend/src/vault/crypto.ts`):
  - Clave de datos AES-256-GCM aleatoria. Cada registro va ligado a su tabla y su id y lleva versión (`v1.`).
  - La clave se guarda envuelta una vez por usuario con su frase secreta (PBKDF2-SHA256, 600.000 iteraciones) y
    otra vez con un **código de recuperación** para imprimir. En el navegador vive en memoria y no es exportable.
  - **Sin frase ni código de recuperación, los datos no se pueden recuperar.**
  - Supabase ve cuántas filas hay, su tamaño y cuándo cambian; el registro de actividad del servidor guarda solo
    quién, cuándo y qué fila. El detalle de cada cambio va cifrado.
- **La web publicada** lleva una política de seguridad (CSP) que solo permite su propio código y conexiones al
  proyecto de Supabase. Solo contiene la clave *publicable* de Supabase (sin sesión con 2FA no da acceso a nada).
  Lo que el cifrado no cubre es una web publicada con código malicioso: por eso el repositorio usa 2FA en GitHub,
  rama principal protegida, dependencias con versión fija y acciones fijadas por commit.
- **Nunca van al repositorio:** facturas, Excel del banco, copias de seguridad ni claves (ver `.gitignore`).

## Desarrollo

```powershell
cd frontend
npm install
copy NUL .env.local   # VITE_SUPABASE_URL=… y VITE_SUPABASE_PUBLISHABLE_KEY=… (solo la clave publicable)
npm run dev           # http://localhost:5173/nube.html
npm test
npm run build:pages   # lo que se publica (dist-pages/)
```

`nube-prueba.html?zip=<copia.zip>` abre la web con los datos de una copia de seguridad en memoria, sin Supabase
(solo para desarrollo; no se publica).

Las pruebas que comparan los resultados con datos reales (`*.parity.test.ts`) se saltan salvo que
`GASTOS_FIXTURES` / `GASTOS_INBOX` apunten a una carpeta local con esos datos.

## Publicación

`.github/workflows/pages.yml` compila y publica en GitHub Pages en cada cambio de `main`. Necesita las variables
del repositorio `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. En Supabase (Authentication → URL
Configuration) la dirección de la web debe estar como *Site URL* y en *Redirect URLs*.

## Administración de Supabase

`supabase/admin.py` (lee las claves de un `.env` local que nunca se sube):

| Orden | Qué hace |
|---|---|
| `aplicar` | crea o actualiza el esquema |
| `miembro <nombre> [--email]` | da de alta a un miembro de la casa (antes hay que invitarlo en Supabase) |
| `enlace <nombre>` | enlace de un solo uso para poner contraseña |
| `contrasena <nombre>` | pone la contraseña desde la terminal |
| `estado` | resumen: miembros, copias de la clave, registros |
| `probar` | comprueba las políticas de acceso |
| `reiniciar --si` | borra todos los datos cifrados (no los usuarios) |

## Versiones

La pestaña **Versiones** muestra el historial de cambios (`frontend/src/versions.ts`).
