// @vitest-environment jsdom

import * as headlessModule from '@lexical/headless';
import * as htmlModule from '@lexical/html';
import * as listModule from '@lexical/list';
import * as markdownModule from '@lexical/markdown';
import * as richTextModule from '@lexical/rich-text';
import * as utilsModule from '@lexical/utils';
import * as upstream from 'lexical';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { isOracleFrame } from '../attribution';
import { Entropy } from '../entropy';
import { fixture } from '../fixture';
import { activate, current, Recorder, wrapModule } from '../membrane';
import { replay } from '../replay-js';

const lexical = wrapModule(upstream, 'lexical');
const html = wrapModule(htmlModule, '@lexical/html');
const headless = wrapModule(headlessModule, '@lexical/headless');
const list = wrapModule(listModule, '@lexical/list');
const markdown = wrapModule(markdownModule, '@lexical/markdown');
wrapModule(richTextModule, '@lexical/rich-text');
const utils = wrapModule(utilsModule, '@lexical/utils');
const utilsPath =
  process.cwd() +
  '/../../target/lexical-upstream/packages/lexical/src/LexicalUtils.ts';
const counterModule = await import(/* @vite-ignore */ utilsPath);
wrapModule(counterModule, 'lexical/LexicalUtils');
const { resetRandomKey } = counterModule;
const source = {
  repo: 'lexical',
  version: '0.45.0',
  file: 'record/__tests__/membrane.test.ts',
  test: [],
  recordedWith: 'lexical-conformance@schema-2',
};

test('async entry depth suppresses inherited test attribution and restores on exit', () => {
  const recorder = new Recorder();
  activate(recorder);
  const exit = recorder.enter('dom-event');
  try {
    lexical.$isTextNode(null);
    const editor = lexical.createEditor({ namespace: 'guarded' });
    editor.update(() => lexical.$getRoot().getChildrenSize(), {
      discrete: true,
    });
  } finally {
    exit();
  }
  expect(recorder.trace.some((op) => op.fn === 'lexical.$isTextNode')).toBe(
    false
  );
  lexical.$isTextNode(null);
  expect(recorder.trace.at(-1)?.fn).toBe('lexical.$isTextNode');
});

test('disposed entropy wrappers delegate to the restored native source', () => {
  const entropy = new Entropy();
  entropy.install();
  const stale = Math.random;
  expect(() => stale()).toThrow('untaped-entropy');
  entropy.dispose();
  expect(stale()).toBeGreaterThanOrEqual(0);
});

test('read flush and deferred callbacks expose their batching boundaries', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'boundaries' });
  editor.update(
    () => lexical.$getRoot().append(lexical.$createParagraphNode()),
    {
      onUpdate: () => {},
    }
  );
  editor.read(() => lexical.$getRoot().getChildrenSize());
  expect(
    recorder.trace.filter((op) => op.op === 'tick').map((op) => op.reason)
  ).toEqual(['read-flush', 'onUpdate']);
  const result = fixture(recorder, source);
  result.trace.unshift({
    op: 'entropy',
    src: 'module-init',
    source: 'random',
    v: 0.5,
  });
  await expect(replay(result, resetRandomKey)).rejects.toThrow(
    'module-init-entropy'
  );
});

let tape: Entropy;
test('nested inline transformer hooks and headless selection replay without original callbacks', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = headless.createHeadlessEditor({
    namespace: 'nested-transformer',
  });
  editor.update(
    () =>
      markdown.$convertFromMarkdownString('plain', [
        {
          type: 'text-match',
          dependencies: [],
          regExp: /never-match$/,
          importRegExp: /never-match/,
          replace: () => {
            throw new Error('unused hook was executed');
          },
          export: () => null,
        },
      ]),
    { discrete: true }
  );
  editor.getEditorState().read(() => lexical.$getSelection());
  const result = fixture(recorder, source);
  expect(result.config.headless).toBe(true);
  expect(recorder.reasons.size).toBe(0);
  await replay(JSON.parse(JSON.stringify(result)), resetRandomKey);
});
test('HTML-seeded markdown export restores a partial JSON state and key layout', async () => {
  const recorder = new Recorder(true);
  activate(recorder);
  const editor = headless.createHeadlessEditor();
  editor.update(
    () => {
      const document = new DOMParser().parseFromString(
        '<p>seeded text</p>',
        'text/html'
      );
      lexical
        .$getRoot()
        .append(...html.$generateNodesFromDOM(editor, document));
    },
    { discrete: true }
  );
  let output: string | undefined;
  editor.getEditorState().read(
    () => {
      output = markdown.$convertToMarkdownString([]);
    },
    { editor }
  );
  expect(output).toBe('seeded text');
  const result = fixture(recorder, source);
  expect(result.partial).toBe(true);
  expect(result.initial.keys).toEqual(['root', '1', '2']);
  expect(recorder.reasons.size).toBe(0);
  await replay(JSON.parse(JSON.stringify(result)), resetRandomKey);
});

beforeEach(() => {
  resetRandomKey();
  tape = new Entropy((op) => current?.trace.push(op), undefined, isOracleFrame);
  tape.install();
});
afterEach(() => {
  tape.dispose();
  activate();
});

// covers: recorder:B1
test('listener-enqueued shortcut records the input and replays the plugin', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({
    namespace: 'test',
    nodes: [
      richTextModule.HeadingNode,
      richTextModule.QuoteNode,
      listModule.ListNode,
      listModule.ListItemNode,
    ],
  });
  markdown.registerMarkdownShortcuts(editor, [markdown.HEADING]);
  editor.update(
    () => {
      const paragraph = lexical.$createParagraphNode();
      lexical.$getRoot().append(paragraph);
      paragraph.select();
    },
    { discrete: true }
  );
  editor.update(
    () => {
      const selection = lexical.$getSelection();
      if (!lexical.$isRangeSelection(selection))
        throw new Error('Expected range');
      selection.insertText('#');
    },
    { discrete: true }
  );
  await Promise.resolve();
  editor.update(
    () => {
      const selection = lexical.$getSelection();
      if (!lexical.$isRangeSelection(selection))
        throw new Error('Expected range');
      selection.insertText(' ');
    },
    { discrete: true }
  );
  await Promise.resolve();
  const result = fixture(recorder, source);
  expect(JSON.stringify(result.trace)).toContain('insertText');
  expect(
    result.trace.some(
      (op) => op.op === 'update' && op.cause === 'listener-enqueued'
    )
  ).toBe(true);
  expect(result.final).toMatchObject({
    json: { root: { children: [{ type: 'heading' }] } },
  });
  expect(JSON.stringify(result.trace)).not.toContain('$createHeadingNode');
  expect(
    result.trace.filter((op) => op.op === 'plugin').map((op) => op.name)
  ).toEqual(['@lexical/markdown.registerMarkdownShortcuts']);
  expect(recorder.reasons).toEqual(new Set());
  await replay(result, resetRandomKey);
});

// covers: recorder:B2
test('update closure records its exact call tree on upstream', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'test' });
  editor.update(
    () => lexical.$getRoot().append(lexical.$createParagraphNode()),
    { discrete: true }
  );
  const result = fixture(recorder, source);
  expect(result.trace.filter((op) => op.op === 'update')).toEqual([
    {
      op: 'update',
      editor: 0,
      id: 0,
      cause: 'test',
      opts: { discrete: true },
      calls: [
        {
          op: 'call',
          fn: 'lexical.$getRoot',
          args: [],
          ret: { $h: 1, key: 'root', type: 'root', ver: 1 },
        },
        {
          op: 'call',
          fn: 'lexical.$createParagraphNode',
          args: [],
          ret: { $h: 2, key: '1', type: 'paragraph', ver: 1 },
        },
        {
          op: 'call',
          fn: 'RootNode.append',
          this: { $h: 1 },
          args: [{ $h: 2 }],
          ret: { $h: 3, key: 'root', type: 'root', ver: 1 },
        },
      ],
    },
  ]);
  await replay(result, resetRandomKey);
});

// covers: recorder:B2
test('tape predicates keep their reads inside the invocation', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({
    namespace: 'test',
    nodes: [listModule.ListNode, listModule.ListItemNode],
  });
  editor.update(
    () => {
      const node = list.$createListItemNode();
      lexical.$getRoot().append(list.$createListNode('bullet').append(node));
      utils.$findMatchingParent(node, (parent) => {
        parent.getType();
        return list.$isListItemNode(parent);
      });
    },
    { discrete: true }
  );
  expect(recorder.tapes).toHaveLength(1);
  expect(recorder.tapes[0].invocations[0].calls.map((op) => op.fn)).toEqual([
    'ListItemNode.getType',
    '@lexical/list.$isListItemNode',
  ]);
  await replay(fixture(recorder, source), resetRandomKey);
});

// covers: recorder:B2
test('nested upstream updates carry their enclosing update id', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'test' });
  editor.update(
    () => {
      lexical.$getRoot().append(lexical.$createParagraphNode());
      editor.update(() => lexical.$getRoot().getChildrenSize());
    },
    { discrete: true }
  );
  const update = recorder.trace.find((op) => op.op === 'update');
  expect(JSON.stringify(update)).toContain('"parent":0');
  await replay(fixture(recorder, source), resetRandomKey);
});

// covers: recorder:B3
test('upstream container reads preserve identity', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'test' });
  editor.update(
    () => {
      const paragraph = lexical.$createParagraphNode();
      lexical.$getRoot().append(paragraph);
      expect(lexical.$getRoot().getChildren()[0]).toBe(
        lexical.$getNodeByKey(paragraph.getKey())
      );
    },
    { discrete: true }
  );
  expect(recorder.reasons).toEqual(new Set());
  await replay(fixture(recorder, source), resetRandomKey);
});

// covers: recorder:B4
test('upstream writable clones leave old field reads stale', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'test' });
  let old: upstream.TextNode;
  editor.update(
    () => {
      old = lexical.$createTextNode('before');
      lexical.$getRoot().append(lexical.$createParagraphNode().append(old));
    },
    { discrete: true }
  );
  editor.update(
    () => {
      old.getWritable().setTextContent('after');
      expect(old.__text).toBe('before');
    },
    { discrete: true }
  );
  await replay(fixture(recorder, source), resetRandomKey);
});

// covers: recorder:B7
test('upstream transform errors are captured through onError', () => {
  const recorder = new Recorder();
  activate(recorder);
  const errors: Error[] = [];
  const editor = lexical.createEditor({
    namespace: 'test',
    onError: (error) => errors.push(error),
  });
  editor.registerNodeTransform(upstream.TextNode, () => {
    throw new Error('transform failed');
  });
  editor.update(
    () =>
      lexical
        .$getRoot()
        .append(
          lexical.$createParagraphNode().append(lexical.$createTextNode('text'))
        ),
    { discrete: true }
  );
  expect(errors.map((error) => error.message)).toEqual(['transform failed']);
  expect(recorder.trace.filter((op) => op.op === 'error')).toEqual([
    {
      op: 'error',
      editor: 0,
      during: 'update',
      name: 'Error',
      message: 'transform failed',
    },
  ]);
});

// covers: recorder:B9
test('an upstream package random read without a tape fails recording', () => {
  const entropy = new Entropy();
  entropy.install();
  try {
    expect(() => upstream.createEditor({ namespace: 'test' })).toThrow(
      'untaped-entropy: random'
    );
  } finally {
    entropy.dispose();
  }
});

// covers: recorder:self-replay-integrity
test('serialized replay rejects corrupt batching, handle versions and operations', async () => {
  const recorder = new Recorder();
  activate(recorder);
  const editor = lexical.createEditor({ namespace: 'test' });
  editor.update(
    () => lexical.$getRoot().append(lexical.$createParagraphNode()),
    { discrete: true }
  );
  const recorded = fixture(recorder, source);
  const corruptBatch = structuredClone(recorded);
  const commit = corruptBatch.trace.find((op) => op.op === 'commit');
  expect(commit).toBeDefined();
  if (commit) commit.updates = [99];
  await expect(replay(corruptBatch, resetRandomKey)).rejects.toThrow(
    'Commit snapshot mismatch'
  );
  const corruptVersion = JSON.parse(
    JSON.stringify(recorded).replace('"ver":1', '"ver":99')
  );
  await expect(replay(corruptVersion, resetRandomKey)).rejects.toThrow(
    'Node version mismatch'
  );
  const corruptOperation = structuredClone(recorded);
  corruptOperation.trace.push({ op: 'unknown' });
  await expect(replay(corruptOperation, resetRandomKey)).rejects.toThrow(
    'Unsupported operation unknown'
  );
});
