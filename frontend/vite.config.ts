import { renameSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// La web publicada (GitHub Pages) es solo la versión con Supabase: nube.html se sirve como index.html y una política de
// seguridad (CSP) impide cargar código de fuera o enviar datos a otro sitio que no sea el proyecto de Supabase.
function pages(supabaseUrl: string): Plugin {
  const host = new URL(supabaseUrl).host;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' https://${host} wss://${host}`,
    "img-src 'self' data: blob:",
    "frame-src blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "pages",
    transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
    closeBundle: () => renameSync("dist-pages/nube.html", "dist-pages/index.html"),
  };
}

// En desarrollo, /api se redirige al backend FastAPI. nube.html es la versión con Supabase (datos cifrados).
export default defineConfig(({ mode }) => {
  if (mode === "pages") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY");
    return {
      base: "./",
      plugins: [react(), pages(env.VITE_SUPABASE_URL)],
      build: { outDir: "dist-pages", rollupOptions: { input: { nube: "nube.html" } } },
    };
  }
  return {
    plugins: [react()],
    server: { proxy: { "/api": "http://127.0.0.1:8000" } },
    build: { rollupOptions: { input: { main: "index.html", nube: "nube.html" } } },
  };
});
