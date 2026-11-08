import path from "node:path";
import { defineConfig } from "vitest/config";
import { buildWasm, pkg } from "./build-wasm";
import { prepareUpstream } from "./prepare-upstream";

buildWasm();
const upstream = await prepareUpstream();
const version = JSON.parse(
  (await import("node:fs")).readFileSync(
    path.join(pkg, "upstream.lock"),
    "utf8",
  ),
).version as string;
const aliases = JSON.parse(
  (await import("node:fs")).readFileSync(
    path.join(upstream, "tsconfig.test.json"),
    "utf8",
  ),
).compilerOptions.paths as Record<string, string[]>;
export default defineConfig({
  root: pkg,
  plugins: [
    {
      name: "production-oracle",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/LexicalUpdates.ts") && id.startsWith(upstream))
          code = code.replace(
            "mutatedNodes = $reconcileRoot(",
            "globalThis.__lexDiffBeforeReconcile?.(editor, currentEditorState._nodeMap, new Map(pendingEditorState._nodeMap)); mutatedNodes = $reconcileRoot(",
          );
        // S1 D-11 keeps the error-mode text offset guard enabled in release.
        // Enable only this upstream guard; all other production behavior stays.
        if (id.endsWith("/caret/LexicalCaret.ts") && id.startsWith(upstream)) {
          const guard = "devInvariant(\n      mode === 'clamp',";
          if (code.split(guard).length !== 2)
            throw new Error("Pinned D-11 text offset guard changed");
          code = code.replace(guard, "invariant(\n      mode === 'clamp',");
        }
        if (id.startsWith(upstream))
          return code
            .replaceAll("process.env.NODE_ENV !== 'production'", "false")
            .replaceAll("process.env.NODE_ENV === 'production'", "true");
      },
    },
  ],
  resolve: {
    alias: Object.entries(aliases).map(([name, [file]]) => ({
      find: new RegExp(
        `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*$/, "(.*)")}$`,
      ),
      replacement: path.resolve(upstream, file).replace(/\*$/, "$1"),
    })),
  },
  test: {
    include: ["diff/**/*.test.ts"],
    // Bun invokes this capture file through the native gate oracle generator.
    exclude: ["diff/gate-fuzz/seed-capture.test.ts"],
    setupFiles: [path.join(pkg, "diff/setup.ts")],
    environment: "jsdom",
    maxWorkers: 1,
    testTimeout: 300000,
    env: { LEXICAL_VERSION: JSON.stringify(version) },
  },
});
