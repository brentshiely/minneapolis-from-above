import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/**
 * Serves Cloudflare Pages Functions from functions/api during `vite dev`,
 * so local development runs the same handler code as production.
 */
function pagesFunctions(): Plugin {
  return {
    name: "pages-functions",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res, next) => {
        const name = /^\/([\w-]+)/.exec(req.url ?? "")?.[1];
        // Any file in functions/api/ is an endpoint, as on Cloudflare.
        if (!name || !existsSync(`functions/api/${name}.ts`)) return next();
        try {
          const mod = await server.ssrLoadModule(`/functions/api/${name}.ts`);
          const response: Response = await mod.onRequestGet({ request: new Request(`http://localhost/api${req.url}`), env: process.env });
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

/**
 * A short hash of each baked file in public/data, so the app can address a
 * file by its contents (see src/dataurl.ts): a re-baked file is fetched at
 * once instead of waiting out the browser's cached copy.
 */
function dataVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync("public/data")) return out;
  for (const f of readdirSync("public/data")) out[f] = createHash("sha1").update(readFileSync(`public/data/${f}`)).digest("hex").slice(0, 10);
  return out;
}

export default defineConfig({
  plugins: [pagesFunctions()],
  define: { __DATA_VERSIONS__: JSON.stringify(dataVersions()) },
  // Agents' worktrees and scratch output live inside the project folder;
  // changes there must not reload the running app.
  server: { watch: { ignored: ["**/.claude/**", "**/.cache/**"] } },
  // The satellite worker (and satellite.js inside it) needs ES module output.
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app: split them out so a
        // deploy only invalidates the app chunk, and the browser downloads
        // the three in parallel.
        advancedChunks: {
          groups: [
            { name: "maplibre", test: /node_modules[\\/]maplibre-gl/ },
            { name: "deckgl", test: /node_modules[\\/](@deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl|@probe\.gl|mjolnir\.js)/ },
            { name: "satellite", test: /node_modules[\\/]satellite\.js/ },
          ],
        },
      },
    },
  },
});
