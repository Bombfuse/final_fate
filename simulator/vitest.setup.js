// Vitest global setup.
// This file is loaded before each test file (see `vite.config.js`).
//
// Keep this lightweight: only put cross-cutting test defaults and browser-like
// polyfills here. Prefer mocking per-test where possible.

import { afterEach } from "vitest";

// If you later add spies/mocks in tests, this ensures they don't leak between tests.
afterEach(() => {
  // In case a test suite uses `vi` without importing it (globals: true),
  // this is still safe: Vitest provides `vi` globally.
  vi.restoreAllMocks();
});

// Some libraries check for these; jsdom provides most browser globals already.
// These guards avoid overwriting if jsdom/Node already defines them.
if (typeof window !== "undefined" && typeof window.requestAnimationFrame !== "function") {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
}

if (typeof window !== "undefined" && typeof window.cancelAnimationFrame !== "function") {
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}
