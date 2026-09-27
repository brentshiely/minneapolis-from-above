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
        const name = /^\/(\w+)/.exec(req.url ?? "")?.[1];
        if (!name || !["vehicles", "aircraft", "flight", "weather", "water", "traffic", "satellites", "satinfo", "debris"].includes(name)) return next();
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

export default defineConfig({
  plugins: [pagesFunctions()],
  // Agents' worktrees and scratch output live inside the project folder;
  // changes there must not reload the running app.
  server: { watch: { ignored: ["**/.claude/**", "**/.cache/**"] } },
  // The satellite worker (and satellite.js inside it) needs ES module output.
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
