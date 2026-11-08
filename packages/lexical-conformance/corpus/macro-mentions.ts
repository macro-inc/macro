// Source authored references and explicit replies, including nested malformed views.
import { mock, setSystemTime } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const { extractChannelMentionsFromMarkdown } = await import(
  root + 'packages/lexical-core/utils/markdown-mentions.ts'
);
const { extractExplicitReply } = await import(
  root + 'packages/lexical-core/utils/explicit-reply.ts'
);
const tag = (name, data) => `<m-${name}>${JSON.stringify(data)}</m-${name}>`;
const inputs = [
  '',
  'plain',
  '> quote',
  ...[
    'channel',
    'project',
    'chat',
    'call',
    'automation',
    'routine',
    'form',
    'database',
    'external_chat',
    'email',
    'calendar',
    'company',
    'contact',
    'initiative',
    'pipeline',
    'md',
  ].map((blockName) =>
    tag('document-mention', {
      blockName,
      documentId: 'reference',
      documentName: 'Name',
    })
  ),
  tag('user-mention', { userId: 'bot|one', email: 'bot@example.com' }),
  tag('user-mention', { userId: 'user-one', email: 'user@example.com' }),
  tag('group-mention', { groupAlias: 'team' }),
  tag('agent-session-mention', { id: 'session', label: 'Session' }),
];
for (const widgets of [
  [],
  [
    {
      type: 'cards',
      items: [
        { type: 'form', id: 'one' },
        { type: 'document', id: 'ignored' },
        { type: 'form', id: 'one' },
      ],
    },
  ],
  [
    {
      type: 'container',
      children: [
        {
          type: 'container',
          children: [{ type: 'cards', items: [{ type: 'form', id: 'two' }] }],
        },
      ],
    },
  ],
  {},
  null,
  [{ type: 'container' }],
  [{ type: 'cards' }],
  [{ type: 'cards', items: {} }],
])
  inputs.push(
    tag('agent-activity', {
      agentSessionId: 'session',
      turn: 0,
      segment: 0,
      sealed: true,
      rows: [
        {
          id: 'row',
          label: 'View',
          status: 'completed',
          card: { kind: 'view', view: { version: 1, widgets } },
        },
      ],
    })
  );
const reply = tag('reply-target', {
  parent: { type: 'channel', id: 'channel' },
  targetMessageId: 'message',
  targetThreadId: 'thread',
  displayText: 'Preview',
  senderId: 'sender',
});
inputs.push(
  reply,
  reply + '\n\ntext',
  reply + '\n\n' + reply,
  reply +
    '\n\n' +
    tag('user-mention', { userId: 'user-one', email: 'user@example.com' })
);
inputs.push(
  inputs[3] + '\n\n' + inputs[3],
  '```\n' + inputs[3] + '\n```',
  '`' + inputs[3] + '`',
  tag('paste', { content: inputs[3], origin: 'pasted' })
);
const rows = [];
for (const markdown of inputs)
  for (const [kind, f] of Object.entries({
    mentions: extractChannelMentionsFromMarkdown,
    reply: extractExplicitReply,
  })) {
    let expected;
    try {
      expected = { value: f(markdown) };
    } catch {
      expected = { throws: true };
    }
    rows.push(JSON.stringify({ kind, markdown, expected }));
  }
const target =
  root +
  'crates/client/lexical/macro_document_model/tests/corpus/mentions.jsonl';
const output = rows.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw Error('Mention source drift');
} else writeFileSync(target, output);
console.log(`Checked ${rows.length} authored reference cases`);
