import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `piloto:styles` lo resuelve el build del embed; en pruebas basta un CSS de mentira.
  resolve: { alias: { "piloto:styles": fileURLToPath(new URL("./test/fixtures/styles-stub.ts", import.meta.url)) } },
  define: { __GHOSTYKIT_VERSION__: JSON.stringify("test") },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], environment: "node" },
});
