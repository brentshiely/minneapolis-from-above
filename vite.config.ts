import { defineConfig } from "vite";

export default defineConfig({
  // MapLibre's worker URL is set explicitly in src/basemap.ts; keep the
  // library out of pre-bundling so dev and build resolve it the same way.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
