import { defineConfig } from "vitest/config";
// vertep starts a worker thread and loads its WebAssembly per actor system: allow for it.
export default defineConfig({ test: { name: "sim", include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 } });
