// Snapshot route oracle: exact frozen bytes, otherwise imported state and common ancestry.
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
const { markdownToLoroSnapshot } = await import(
  root + 'packages/lexical-core/markdown-loro-snapshot.ts'
);
const { notionMarkdownToLoroSnapshot } = await import(
  root + 'packages/lexical-core/notion-markdown.ts'
);
const { MARKDOWN_GOLDEN } = await import(
  root + 'packages/lexical-core/markdown-golden.1.ts'
);
const { LoroDoc } = await import('loro-crdt');
if (process.argv.includes('--decode-rust')) {
  const { LoroDoc: LegacyDoc } = await import('loro-crdt-legacy');
  const snapshots: string[] = await Bun.stdin.json();
  const states = [LoroDoc, LegacyDoc].map((Doc) =>
    snapshots.map((bytes) => {
      const doc = new Doc();
      doc.import(Buffer.from(bytes, 'base64'));
      return doc.toJSON();
    })
  );
  await Bun.write(Bun.stdout, JSON.stringify(states));
  process.exit(0);
}
const links = {
  pages: {
    '11111111111111111111111111111111': {
      documentId: 'document-one',
      name: 'Page',
    },
  },
  users: {
    '22222222222222222222222222222222': {
      userId: 'user-one',
      email: 'user@example.com',
    },
  },
};
const inputs = [
  '',
  ' ',
  '\ufeff\n\t',
  '# Heading\n\nA **bold** 😀 line',
  '- one\n  - two',
  '- [ ] task\n- [x] finished',
  '```rust\nlet n = 1;\n```',
  '> quote\n> more',
  '[link](https://example.com)',
  'line\n\n\nlast',
  '<m-user-mention>{"userId":"one","email":"user@example.com"}</m-user-mention>',
  '[Page](11111111111111111111111111111111)\n\n<mention-user id="22222222222222222222222222222222"/>',
  '::: callout\nCallout\n:::',
  '| A | B |\n| --- | --- |\n| C | D |',
];
const rows = [];
for (const kind of ['markdown', 'notion'])
  for (const input of inputs) {
    const result =
      kind === 'markdown'
        ? { snapshot: await markdownToLoroSnapshot(input) }
        : await notionMarkdownToLoroSnapshot(input, links);
    if (!result.snapshot) throw new Error('Source snapshot missing');
    const doc = new LoroDoc();
    doc.import(result.snapshot);
    const golden = Buffer.from(result.snapshot).equals(
      Buffer.from(MARKDOWN_GOLDEN)
    );
    rows.push(
      JSON.stringify({
        kind,
        input,
        links,
        state: doc.toJSON(),
        markdown: result.markdown,
        golden,
        ...(golden
          ? { bytes: Buffer.from(result.snapshot).toString('base64') }
          : {}),
      })
    );
  }
const target =
  root +
  'crates/client/lexical/macro_document_model/tests/corpus/snapshots.jsonl';
const text = rows.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text)
    throw new Error('Snapshot source oracle drift');
} else writeFileSync(target, text);
console.log(`Checked ${rows.length} source snapshot route cases`);
