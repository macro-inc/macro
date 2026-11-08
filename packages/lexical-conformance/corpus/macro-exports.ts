// Independent lexical-service export and XML oracle from actual source entry points.
import { mock, setSystemTime } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const source = await import(
  root + 'services/lexical-service/src/lib/convsersions.ts'
);
const xml = await import(
  root + 'packages/lexical-core/transformers/xml/index.ts'
);
const counts = new Map<string, number>();
const inputs = readFileSync(
  root + 'crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
  'utf8'
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .filter((row) => {
    if (row.profile !== 'export') return false;
    const count = counts.get(row.type) ?? 0;
    counts.set(row.type, count + 1);
    return count < 3;
  });
inputs.push({
  name: 'custom-code:learned-state-order',
  input: {
    root: {
      type: 'root',
      children: [
        {
          type: 'custom-code',
          version: 1,
          language: 'rust',
          $: { id: 'first', extra: 'kept' },
          children: [{ type: 'text', text: 'code' }],
        },
        {
          type: 'custom-code',
          version: 1,
          language: 'rust',
          $: { id: 'second', extra: 'kept' },
          children: [{ type: 'text', text: 'code' }],
        },
        {
          type: 'custom-code',
          version: 1,
          language: 'rust',
          $: { id: 'third', extra: 'kept' },
          children: [{ type: 'text', text: 'code' }],
        },
      ],
    },
  },
});
inputs.push({
  name: 'partial-import:export',
  input: {
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          $: { id: 'prefix' },
          children: [{ type: 'text', version: 1, text: 'retained' }],
        },
        { type: 'unknown-export-node', version: 1 },
      ],
    },
  },
});
const identified = inputs.map((row) => {
  const input = structuredClone(row.input);
  input.root.children.forEach((node, index) => {
    node.$ = {
      extraBefore: 1,
      ...(node.$ ?? {}),
      id: `block-${index}`,
      extraAfter: 2,
    };
  });
  return { ...row, name: row.name + ':identified', input };
});
const output = [];
const originalLog = console.log;
const originalError = console.error;
console.log = () => {};
console.error = () => {};
for (const row of [...inputs, ...identified]) {
  const results = {};
  for (const [name, operation] of Object.entries({
    plaintext: () => source.toPlaintext(row.input),
    search: () => source.toSearchText(row.input),
    cognition: () => source.toCognitionText(row.input),
    cognitionV2: () => source.toCognitionV2(row.input),
    internal: () => source.toMarkdownText(row.input),
    external: () => source.toMarkdownText(row.input, 'external'),
    externalHost: () => {
      globalThis.window = { location: { hostname: 'app.example.com' } };
      try {
        return source.toMarkdownText(row.input, 'external');
      } finally {
        delete globalThis.window;
      }
    },
    embedding: () => source.toMarkdownText(row.input, 'embedding'),
    xml: () => xml.toXml(row.input),
  })) {
    try {
      results[name] = { value: operation() };
    } catch {
      results[name] = { throws: true };
    }
  }
  output.push(JSON.stringify({ name: row.name, input: row.input, results }));
}
console.log = originalLog;
console.error = originalError;
const target =
  root +
  'crates/client/lexical/macro_document_model/tests/corpus/exports.jsonl';
const text = output.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text)
    throw new Error('Service export oracle drift');
} else {
  writeFileSync(target, text);
}
console.log(`Checked ${output.length} source service export / XML cases`);
