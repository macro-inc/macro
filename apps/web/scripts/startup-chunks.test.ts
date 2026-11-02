import { build, type Rollup } from 'vite';
import { expect, it } from 'vitest';
import { pureGeneratedZodSchemas } from './pure-generated-zod-schemas';
import { startupChunks } from './startup-chunks';

it('keeps service validation and its library behind the feature boundary when boot uses its enum', async () => {
  const service = '/service-storage/generated';
  const modules: Record<string, string> = {
    entry: `import { kind } from '${service}/index.js'; export const boot = kind; export const open = () => import('feature');`,
    [`${service}/index.js`]: `export const kind = 'document'; export { schema } from '${service}/zod.ts';`,
    [`${service}/zod.ts`]: `import { construct } from '/node_modules/effect/index.js'; export const schema = construct();`,
    '/node_modules/effect/index.js': `export const construct = () => ({ marker: 'feature-validation-only' });`,
    feature: `import { schema } from '${service}/zod.ts'; export function validate(input) { return input === schema.marker; }`,
  };
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [pureGeneratedZodSchemas(), {
      name: 'feature-fixture',
      resolveId(id) { if (id in modules) return id; },
      load(id) { if (id in modules) return { code: modules[id], moduleSideEffects: false }; },
    }],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'entry',
        preserveEntrySignatures: 'strict',
        output: { manualChunks: startupChunks(), onlyExplicitManualChunks: true },
      },
    },
  })) as Rollup.RollupOutput;
  const chunks = result.output.filter((file) => file.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error('missing entry');
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const chunk = chunks.find((chunk) => chunk.fileName === file);
    if (!chunk) throw new Error(`missing chunk ${file}`);
    expect(chunk.code).not.toContain('feature-validation-only');
    for (const dependency of chunk.imports) visit(dependency);
  }
  visit(entry.fileName);
  expect(chunks.some((chunk) => chunk.code.includes('feature-validation-only'))).toBe(true);
  expect(entry.dynamicImports).not.toHaveLength(0);
});
