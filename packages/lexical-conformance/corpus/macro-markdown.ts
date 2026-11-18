// Independent source conversion oracle supplementing the recorded source corpus.
import { mock, setSystemTime } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
Object.assign(globalThis, { window: { location: { hostname: 'localhost' } } });
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
const { SupportedNodeTypes, NodeReplacements } = await import(
  root + 'packages/lexical-core/node-list.ts'
);
const lists = await import(
  root + 'packages/lexical-core/transformers/index.ts'
);
const { createHeadlessEditor } = await import(
  root + 'node_modules/@lexical/headless/dist/LexicalHeadless.node.mjs'
);
const { $convertFromMarkdownString, $convertToMarkdownString } = await import(
  root + 'node_modules/@lexical/markdown/dist/LexicalMarkdown.node.mjs'
);
const inputs = new Set<string>();
function collect(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (
    'fn' in value &&
    'args' in value &&
    String(value.fn).endsWith('.$convertFromMarkdownString') &&
    Array.isArray(value.args) &&
    typeof value.args[0] === 'string'
  )
    inputs.add(value.args[0]);
  for (const child of Object.values(value)) collect(child);
}
const directory =
  root + 'packages/lexical-conformance/fixtures/upstream/lexical-core/';
for (const file of readdirSync(directory).sort())
  collect(JSON.parse(readFileSync(directory + file, 'utf8')));
for (const [tag, data] of [
  [
    'm-reply-target',
    {
      parent: { type: 'channel', id: 'channel' },
      targetMessageId: 'message',
      targetThreadId: 'thread',
      displayText: 'Example',
      senderId: 'sender',
    },
  ],
  [
    'm-document-mention',
    {
      documentId: 'doc',
      mentionUuid: 'ignored',
      channelType: 'channel',
      createdAt: 123,
    },
  ],
  [
    'm-contact-mention',
    {
      contactId: 'contact',
      name: 'Example',
      emailOrDomain: 'example.com',
      isCompany: true,
      mentionUuid: 'ignored',
    },
  ],
  [
    'm-user-mention',
    {
      userId: 'macro|user@example.com',
      email: 'user@example.com',
      mentionUuid: 'ignored',
    },
  ],
  [
    'm-video',
    {
      url: 'https://example.com/video.mp4',
      width: '0x10',
      height: [12],
      srcType: {},
      id: [1, 2],
    },
  ],
  [
    'm-agent-activity',
    {
      sealed: true,
      rows: [],
      segment: 0,
      turn: 1,
      agentSessionId: 'session',
      future: 'retained',
    },
  ],
] as const)
  inputs.add(`<${tag}>${JSON.stringify(data)}</${tag}>`);
const unlinkedState = {
  root: {
    children: [
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 1,
                mode: 'normal',
                style: '',
                text: 'https://example.com',
                type: 'text',
                version: 1,
              },
            ],
            direction: null,
            format: '',
            indent: 0,
            type: 'autolink',
            version: 1,
            rel: null,
            target: null,
            title: null,
            url: 'https://example.com',
            isUnlinked: true,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};
const output: unknown[] = [];
for (const profile of ['export', 'headless']) {
  for (const [list, transformers] of [
    ['internal', lists.INTERNAL_TRANSFORMERS],
    ['external', lists.EXTERNAL_TRANSFORMERS],
    ['all', lists.ALL_TRANSFORMERS],
  ] as const) {
    for (const initial of [unlinkedState]) {
      const editor = createHeadlessEditor({
        nodes:
          profile === 'headless'
            ? [...SupportedNodeTypes, ...NodeReplacements]
            : SupportedNodeTypes,
        onError(error: Error) {
          throw error;
        },
      });
      const state = editor.parseEditorState(initial);
      const json = JSON.stringify(state.toJSON());
      const markdown = state.read(() => $convertToMarkdownString(transformers));
      output.push({ profile, list, input: '', initial, json, markdown });
    }
    for (const input of inputs) {
      const editor = createHeadlessEditor({
        nodes:
          profile === 'headless'
            ? [...SupportedNodeTypes, ...NodeReplacements]
            : SupportedNodeTypes,
        onError(error: Error) {
          throw error;
        },
      });
      try {
        editor.update(() => $convertFromMarkdownString(input, transformers), {
          discrete: true,
        });
        const json = JSON.stringify(editor.getEditorState().toJSON());
        const markdown = editor
          .getEditorState()
          .read(() => $convertToMarkdownString(transformers));
        output.push({ profile, list, input, json, markdown });
      } catch (error) {
        output.push({ profile, list, input, error: String(error) });
      }
    }
  }
}
const path =
  root +
  'crates/client/lexical/macro_document_model/tests/corpus/conversions.jsonl';
const contents = output.map((row) => JSON.stringify(row)).join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== contents)
    throw new Error('Macro conversion oracle drift');
} else writeFileSync(path, contents);
console.log(
  `Checked ${output.length} source conversions from ${inputs.size} authored markdown inputs`
);
