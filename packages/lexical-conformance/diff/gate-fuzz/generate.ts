// Fixed-seed adversarial pairs evaluated only by the real lexical-service gate.
import { mock, setSystemTime } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { plugin } from 'bun';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

type GateNode = SerializedLexicalNode & {
  [field: string]: unknown;
  children?: GateNode[];
  text?: string;
  format?: string | number;
  style?: string;
  mode?: string;
  detail?: number;
  language?: string;
  $?: Record<string, unknown>;
};

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Output JSONL path required');
const seedFile = output + '.seeds.json';
const seeds = spawnSync(
  'bun',
  [
    'test',
    root + 'packages/lexical-conformance/diff/gate-fuzz/seed-capture.test.ts',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GATE_SEED_OUTPUT: seedFile },
  }
);
if (seeds.status !== 0) throw new Error(seeds.stdout + seeds.stderr);
setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
plugin({
  name: 'observe-gate-normalization',
  setup(builder) {
    builder.onLoad(
      { filter: /\/lib\/comment-only-change\.ts$/ },
      ({ path }) => ({
        contents:
          readFileSync(path, 'utf8') + '\nexport {contentWithoutComments};',
        loader: 'ts',
      })
    );
  },
});
const { isCommentOnlyChange, contentWithoutComments } = await import(
  root + 'services/lexical-service/src/lib/comment-only-change.ts'
);
const seedPairs = JSON.parse(readFileSync(seedFile, 'utf8'));
const synthetic = readFileSync(
  root + 'crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
  'utf8'
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .filter((row) => row.profile === 'export');
let rng = 0x71d44c2b;
function random() {
  rng ^= rng << 13;
  rng ^= rng >>> 17;
  rng ^= rng << 5;
  return rng >>> 0;
}
function walk(node: GateNode, out: GateNode[] = []): GateNode[] {
  if (node && typeof node === 'object') {
    out.push(node);
    if (Array.isArray(node.children))
      for (const child of node.children) walk(child, out);
  }
  return out;
}
function observe(before: SerializedEditorState, after: SerializedEditorState) {
  try {
    return {
      commentOnly: isCommentOnlyChange(before, after),
      before: contentWithoutComments(before),
      after: contentWithoutComments(after),
    };
  } catch {
    return { throws: true };
  }
}
let sourceErrors: string[] = [];
export type SourceErrorRow = { index: number; errors: string[] };
const sourceErrorRows: SourceErrorRow[] = [];
const sourceConsoleError = console.error;
console.error = (...args: unknown[]) => {
  sourceErrors.push(
    args
      .map((value) => (value instanceof Error ? value.message : String(value)))
      .join(' ')
  );
};
const lines: string[] = [];
for (let index = 0; index < 20000; index++) {
  const seed = seedPairs[index % seedPairs.length];
  let before = structuredClone(seed.before);
  let after = structuredClone(seed.after);
  if (index >= 12 && index % 3 === 0) {
    before = structuredClone(synthetic[random() % synthetic.length].input);
    after = structuredClone(before);
  }
  if (index >= 12) {
    const nodes = walk(after.root);
    const node = nodes[random() % nodes.length];
    const text = nodes.find(
      (value): value is GateNode & { text: string } => value.type === 'text'
    );
    const mutation = index % 20;
    switch (mutation) {
      case 0:
        node.$ = {
          ...(node.$ ?? {}),
          id: `id-${random()}`,
          peerId: 'peer',
          sharedPeerIds: [],
          local: true,
        };
        break;
      case 1:
        node.$ = { ...(node.$ ?? {}), retained: random() % 9 };
        break;
      case 2:
        if (text) text.text += '!';
        break;
      case 3:
        if (text) text.format = random() % 128;
        break;
      case 4:
        if (text) text.style = 'color: red';
        break;
      case 5:
        if (text) text.mode = ['normal', 'token', 'segmented'][random() % 3];
        break;
      case 6:
        if (text) text.detail = random() % 4;
        break;
      case 7:
        node.type = 'unknown-gate-node';
        break;
      case 8:
        if (Array.isArray(node.children)) node.children.reverse();
        break;
      case 9:
        if (Array.isArray(node.children)) node.children.pop();
        break;
      case 10:
        if (text) {
          const parent = nodes.find((value) => value.children?.includes(text));
          if (!parent?.children) throw new Error('Text fixture has no parent');
          const at = parent.children.indexOf(text);
          let split = random() % (text.text.length + 1);
          if (
            split > 0 &&
            split < text.text.length &&
            /[\uD800-\uDBFF]/.test(text.text[split - 1]) &&
            /[\uDC00-\uDFFF]/.test(text.text[split])
          )
            split++;
          parent.children.splice(
            at,
            1,
            { ...text, text: text.text.slice(0, split) },
            {
              type: 'comment-mark',
              version: 1,
              ids: ['overlap', 'second'],
              isDraft: Boolean(random() % 2),
              children: [{ ...text, text: text.text.slice(split) }],
            }
          );
        }
        break;
      case 11:
        node.type =
          node.type === 'code'
            ? 'custom-code'
            : node.type === 'list'
              ? 'task-list'
              : node.type;
        break;
      case 12:
        if (text) {
          delete text.style;
          delete text.mode;
        }
        break;
      case 13:
        node.format = String(random() % 4);
        break;
      case 14:
        node.children = [
          {
            type: 'comment-mark',
            version: 1,
            ids: ['m'],
            children: node.children ?? [],
          },
        ];
        break;
      case 15:
        if (node.type === 'code' || node.type === 'custom-code')
          node.language = 'rust';
        break;
      case 16:
        if (text) text.$ = { retained: { value: 1 } };
        break;
      case 17:
        if (node.children) {
          for (let depth = 0; depth < 20; depth++)
            node.children = [
              {
                type: 'comment-mark',
                version: 1,
                ids: ['deep'],
                children: node.children,
              },
            ];
        }
        break;
      case 18:
        for (const value of nodes) {
          const entries = Object.entries(value).reverse();
          for (const key of Object.keys(value)) delete value[key];
          Object.assign(value, Object.fromEntries(entries));
        }
        break;
      case 19:
        if (text) text.text = '';
        break;
    }
  }
  sourceErrors = [];
  lines.push(
    JSON.stringify({ index, before, after, expected: observe(before, after) })
  );
  sourceErrorRows.push({ index, errors: sourceErrors });
}
console.error = sourceConsoleError;
writeFileSync(output, lines.join('\n') + '\n');
writeFileSync(output + '.errors.json', JSON.stringify(sourceErrorRows));
console.log(
  `Checked 12 service seeds and generated ${lines.length} gate oracle cases`
);
