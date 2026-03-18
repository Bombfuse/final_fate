import { defineConfig } from "vite";

export default defineConfig({
  // Vite will serve from this folder; `index.html` is at the project root.
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },

  // Vitest config lives here so it stays in sync with Vite's resolver/aliases.
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{js,ts}", "src/**/*.spec.{js,ts}"],
    setupFiles: ["./vitest.setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.d.ts",
      ],
    },
  },
});
