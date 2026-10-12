// Genera la demo autocontenida (un solo HTML, API simulada) en dist-demo/gastos-casa-demo.html
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { build } from "vite";


await build({
  logLevel: "warn",
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: "demo.html", output: { inlineDynamicImports: true } },
  },
});

const assets = "dist-demo/assets";
const files = readdirSync(assets);
const js = readFileSync(`${assets}/${files.find((f) => f.endsWith(".js"))}`, "utf8").replaceAll("</script", "<\/script");
const css = readFileSync(`${assets}/${files.find((f) => f.endsWith(".css"))}`, "utf8");

const html = `<title>Gastos de casa</title>
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync("dist-demo/gastos-casa-demo.html", html);
console.log(`dist-demo/gastos-casa-demo.html (${Math.round(html.length / 1024)} kB)`);
