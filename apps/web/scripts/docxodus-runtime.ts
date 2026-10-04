import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Serve and emit the Docxodus .NET WebAssembly runtime.
 *
 * `dotnet.js` loads its sibling assemblies by name from its own directory, so
 * the runtime has to keep its `_framework` layout and file names; bundling the
 * files individually would hash them apart. The runtime is published under a
 * versioned path (`docxodus/<version>/_framework/…`) so a deploy never mixes
 * JavaScript wrappers from one release with assemblies from another.
 * Precompressed `.br` twins are skipped: hosts negotiate compression.
 */
export function docxodusRuntime(): Plugin {
  // The package exports only its ESM entry (dist/index.js); its root is two up.
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('docxodus'))));
  const { version } = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
  ) as { version: string };
  const framework = join(packageRoot, 'dist/wasm/_framework');
  const prefix = `docxodus/${version}/_framework/`;
  const files = () =>
    readdirSync(framework).filter(
      (name) => !name.endsWith('.br') && statSync(join(framework, name)).isFile()
    );
  const contentType = (name: string) =>
    name.endsWith('.wasm')
      ? 'application/wasm'
      : name.endsWith('.js')
        ? 'text/javascript'
        : name.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream';

  return {
    name: 'docxodus-runtime',
    config: () => ({
      define: {
        'import.meta.env.DOCXODUS_VERSION': JSON.stringify(version),
      },
    }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        const at = path.indexOf(prefix);
        if (at < 0) return next();
        const name = path.slice(at + prefix.length);
        if (!files().includes(name)) return next();
        res.setHeader('Content-Type', contentType(name));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(join(framework, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of files())
        this.emitFile({
          type: 'asset',
          fileName: `${prefix}${name}`,
          source: readFileSync(join(framework, name)),
        });
    },
  };
}
