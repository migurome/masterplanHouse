import { createClient } from "@supabase/supabase-js";

// Solo la URL del proyecto y la clave PUBLICABLE (pública por diseño: sin sesión con segundo factor no da acceso a nada).
// La clave secreta nunca va al navegador.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = Boolean(url && key);

// Antes de que el cliente lea el enlace del correo: ¿venimos de una invitación o de "olvidé mi contraseña"?
const hash = new URLSearchParams(window.location.hash.slice(1));
export const linkType = hash.get("type"); // "invite" | "recovery" | null
export const linkError = hash.get("error_description");

export const supabase = createClient(url ?? "http://localhost", key ?? "sin-configurar", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const BUCKET = "documentos";

/** Mensaje legible de un error de Supabase. */
export function problem(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  const known: Record<string, string> = {
    "Invalid login credentials": "Correo o contraseña incorrectos.",
    "Invalid TOTP code entered": "Código incorrecto. Comprueba la hora del móvil y prueba con el siguiente.",
    "Email not confirmed": "El correo aún no está confirmado.",
  };
  return known[msg] ?? msg;
}
