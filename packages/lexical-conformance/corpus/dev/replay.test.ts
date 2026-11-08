import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { oracle, snapshotValue } from './oracle';
import { gatePairs } from './pairs';
import { object } from './scan';

const wasm: { corpus_route(route: string, input: string): string } =
  createRequire(import.meta.url)('../../pkg/node/lexical_conformance_wasm.js');
const state = {
  root: {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [
      {
        type: 'paragraph',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'A **literal** 😀 line',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
};

test('actual source and WASM export and composer adapters agree on literal inputs', async () => {
  for (const [route, input] of [
    ...[
      'plaintext',
      'search',
      'cognition',
      'cognitionv2',
      'xml',
      'json-roundtrip',
      'markdown/internal',
      'markdown/external',
      'markdown/embedding',
    ].map((route) => [route, { state }] as const),
    ['comment-mark', { state, markId: 'missing' }],
    ['mentions', { markdown: 'literal' }],
    ['extract-reply', { markdown: 'literal' }],
    ['agent-context', { promptMarkdown: 'literal' }],
    [
      'agent-chat-reply',
      { sessionId: 'session', body: { kind: 'markdown', markdown: 'literal' } },
    ],
    [
      'agent-announcement',
      {
        chip: {
          agentSessionId: 'session',
          promptedMessage: null,
          status: 'acp_ready',
        },
      },
    ],
    [
      'agent-connection-prompt',
      {
        agentTag: 'tag',
        message: 'literal',
        chip: { appSlug: 'app', name: 'Connect', target: 'harness' },
      },
    ],
    [
      'image-markdown',
      {
        staticFileId: 'image',
        url: 'https://example.com/image.png',
        width: 640,
        height: 480,
      },
    ],
  ] as [string, Record<string, unknown>][]) {
    const source = await oracle(route, input);
    expect(source).toHaveProperty('ok');
    expect(JSON.parse(wasm.corpus_route(route, JSON.stringify(input)))).toEqual(
      source
    );
  }
});

test('snapshot adapters compare deep state and frozen empty snapshot bytes', async () => {
  for (const route of [
    'snapshot/markdown',
    'snapshot/notion',
    'snapshot/state',
  ]) {
    const input =
      route === 'snapshot/state'
        ? { state }
        : { markdown: 'literal', links: { pages: {}, users: {} } };
    const source: unknown = await oracle(route, input);
    const actual: unknown = JSON.parse(
      wasm.corpus_route(route, JSON.stringify(input))
    );
    expect(object(source) && 'ok' in source).toBe(true);
    expect(object(actual) && 'ok' in actual).toBe(true);
    if (object(source) && object(actual))
      expect(snapshotValue(actual.ok)).toEqual(snapshotValue(source.ok));
  }
  const input = { markdown: '' };
  expect(
    JSON.parse(wasm.corpus_route('snapshot/markdown', JSON.stringify(input)))
  ).toEqual(await oracle('snapshot/markdown', input));
});

test('gate adapters compare normalized states as well as permission verdicts', async () => {
  for (const pair of gatePairs(state)) {
    const input = { before: state, after: pair.after };
    const source = await oracle('comment-only-change', input);
    expect(source).toHaveProperty('ok');
    expect(
      JSON.parse(
        wasm.corpus_route('comment-only-change', JSON.stringify(input))
      )
    ).toEqual(source);
  }
});

test('observing gate JSON reuses the production entropy sequence for missing await ids', async () => {
  const before = {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [{ type: 'await', version: 1, text: 'pending', inline: false }],
    },
  };
  const input = { before, after: structuredClone(before) };
  const source = await oracle('comment-only-change', input);
  expect(source).toHaveProperty('ok');
  expect(
    JSON.parse(wasm.corpus_route('comment-only-change', JSON.stringify(input)))
  ).toEqual(source);
});

test('formatted comment splits preserve astral text boundaries', async () => {
  const before = structuredClone(state);
  before.root.children[0].children[0].text = '😀hello';
  before.root.children[0].children[0].format = 1;
  const pair = gatePairs(before).find((pair) => pair.kind === 'wrap-split');
  expect(pair).toBeDefined();
  const input = { before, after: pair?.after };
  const source = await oracle('comment-only-change', input);
  expect(source).toHaveProperty('ok');
  expect(
    JSON.parse(wasm.corpus_route('comment-only-change', JSON.stringify(input)))
  ).toEqual(source);
});
