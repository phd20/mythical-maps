import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./test/mocks/obsidian.ts", import.meta.url)),
      // Leaflet needs a browser `window` at import time; tests use a recording stub.
      leaflet: fileURLToPath(new URL("./test/mocks/leaflet.ts", import.meta.url)),
      // Geoman patches the global Leaflet in the browser; tests stub it out (see src/ui/geoman.ts).
      "@geoman-io/leaflet-geoman-free": fileURLToPath(new URL("./test/mocks/geoman.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
