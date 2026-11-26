import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import type { Plugin } from 'vite';

const PREFIX = 'virtual:sandboxed-frame/';

/**
 * `import code from 'virtual:sandboxed-frame/<path>'` gives the module at
 * `src/<path>.ts`, with everything it imports, bundled into one ES module as a
 * string. A sandboxed srcdoc frame (opaque origin, no network) runs it as an
 * inline module script, so it can't load chunks the way the app does.
 */
export function sandboxedFrameBundle(options: {
  root: string;
  minify: boolean;
}): Plugin {
  return {
    name: 'macro-sandboxed-frame-bundle',
    resolveId(source) {
      return source.startsWith(PREFIX) ? `\0${source}` : null;
    },
    async load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      const entry = resolve(
        options.root,
        'src',
        `${id.slice(PREFIX.length + 1)}.ts`
      );

      const bundle = await rolldown({ input: entry, platform: 'browser' });
      try {
        const { output } = await bundle.generate({
          format: 'esm',
          minify: options.minify,
        });
        if (output.length !== 1) {
          throw new Error(`${entry} must bundle to one chunk`);
        }
        for (const file of await bundle.watchFiles) this.addWatchFile(file);
        return `export default ${JSON.stringify(output[0].code)};`;
      } finally {
        await bundle.close();
      }
    },
  };
}
