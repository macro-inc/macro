import type { Rollup } from 'vite';

/** Size-limited owners, without coalescing unrelated lazy features into boot. */
export function startupChunks(): Rollup.ManualChunksOption {
  let sessionModules: Set<string> | undefined;
  return (id, graph) => {
    // This one small entry starts a cookie check while the app downloads. Keep
    // its static dependency closure independent of shared UI chunk placement.
    // It contains no view implementations, query, analytics or editor imports.
    if (!sessionModules) {
      const modules = new Set<string>();
      sessionModules = modules;
      const visit = (module: string) => {
        if (modules.has(module)) return;
        modules.add(module);
        for (const dependency of graph.getModuleInfo(module)?.importedIds ?? [])
          visit(dependency);
      };
      const session = [...graph.getModuleIds()].find((module) =>
        module.endsWith('/src/session-bootstrap.ts')
      );
      if (session) visit(session);
    }
    // Runtime consumers may share dependencies, never the executable entry.
    if (sessionModules.has(id) && !id.endsWith('/src/session-bootstrap.ts'))
      return 'session-runtime';

    // Keep generated validators independent of eagerly used enum modules from
    // the same service. Loading a constant must not load its service's schemas.
    const validators = id.match(/\/service-([^/]+)\/generated\/zod\.ts$/);
    if (validators) return `validation-${validators[1]}`;
    if (id.endsWith('/service-cognition/generated/tools/schemas.ts'))
      return 'validation-tools';
    if (id.endsWith('/service-storage/graphql/generated/graphql.ts'))
      return 'graphql-documents';
    if (id.endsWith('/collaboration/src/sync-service/generated/schema.ts'))
      return 'validation-sync';

    // These independent library owners keep the shared app's source map below
    // the symbolication limit. Other libraries follow Rollup's feature graph.
    if (/\/node_modules\/(?:@lexical\/[^/]+|lexical)\//.test(id))
      return 'editor-vendor';
    if (/\/node_modules\/effect\//.test(id)) return 'effect-vendor';
    if (/\/node_modules\/posthog-js\//.test(id)) return 'analytics-vendor';
  };
}
