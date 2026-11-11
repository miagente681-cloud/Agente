import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" corta la compilación de Next si un módulo del servidor llega al navegador; en las pruebas no aplica.
      "server-only": path.resolve(import.meta.dirname, "tests/apoyo/vacio.ts"),
    },
  },
});
