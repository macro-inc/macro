// @vitest-environment jsdom
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { expect, test } from 'vitest';
import { installNativeCodeChrome } from './native-code-highlight-dom';

type StubNode = {
  key: number;
  type: string;
  kind: 'element' | 'text' | 'linebreak';
  children: number[];
  /** The custom-code view's data-language, written before the chrome installs. */
  language?: string;
};

/**
 * CONSUMER-ONLY stub: an EditorView slice exposing the mirror, elements and
 * listener registries that the chrome installer reads. It proves what the
 * installer does with a supplied mirror, mutation or report, not that a default
 * session mounts the installer or produces reports.
 */
function stubView(
  nodes: StubNode[],
  failures: { subscribeReports?: unknown; releaseMutations?: unknown } = {}
) {
  const mirror = new Map(nodes.map((node) => [node.key, node]));
  const elements = new Map<number, HTMLElement>();
  for (const node of nodes)
    if (node.type === 'custom-code') {
      const element = document.createElement('code');
      element.setAttribute('spellcheck', 'false');
      if (node.language) element.setAttribute('data-language', node.language);
      element.setAttribute('dir', 'auto');
      elements.set(node.key, element);
    }
  const mutations = new Set<(changes: ReadonlyMap<number, string>) => void>();
  const pluginEvents = new Set<(payload: unknown) => void>();
  const view = {
    mirror: { values: () => mirror.values(), keyGeneration: 0 },
    node: (key: number) => mirror.get(key),
    getElementByKey: (key: number) => elements.get(key) ?? null,
    onMutations: (
      _type: string,
      listener: (changes: ReadonlyMap<number, string>) => void
    ) => {
      mutations.add(listener);
      return () => {
        mutations.delete(listener);
        if (failures.releaseMutations) throw failures.releaseMutations;
      };
    },
    onPluginEvent: (_name: string, listener: (payload: unknown) => void) => {
      if (failures.subscribeReports) throw failures.subscribeReports;
      pluginEvents.add(listener);
      return () => pluginEvents.delete(listener);
    },
  } as unknown as EditorView;
  const remount = (key: number) => {
    const previous = elements.get(key)!;
    const element = document.createElement('code');
    for (const name of ['spellcheck', 'data-language', 'dir'])
      if (previous.hasAttribute(name))
        element.setAttribute(name, previous.getAttribute(name)!);
    elements.set(key, element);
    return element;
  };
  const dispatch = (key: number, mutation: string) => {
    for (const listener of mutations) listener(new Map([[key, mutation]]));
  };
  return { view, mirror, elements, mutations, pluginEvents, remount, dispatch };
}

// Source codePlugin registers code highlighting, and with it updateCodeGutter,
// for every editor view; the OFF stored-null capture opens with data-gutter="1".
// A stored string language opens without data-highlight-language (OFF loaded
// capture); only a highlighter transform run adds it.
test('writes the Source gutter without a code tokenizer', () => {
  const { view, elements, pluginEvents } = stubView([
    { key: 5, type: 'custom-code', kind: 'element', children: [6] },
    { key: 6, type: 'text', kind: 'text', children: [] },
    {
      key: 9,
      type: 'custom-code',
      kind: 'element',
      children: [10],
      language: 'rust',
    },
    { key: 10, type: 'text', kind: 'text', children: [] },
  ]);
  const release = installNativeCodeChrome(view, { codeHighlighting: false });
  const element = elements.get(5)!;
  expect(element.getAttributeNames()).toEqual([
    'spellcheck',
    'dir',
    'data-gutter',
  ]);
  expect(element.getAttribute('data-gutter')).toBe('1');
  const rust = elements.get(9)!;
  expect(rust.getAttributeNames()).toEqual([
    'spellcheck',
    'data-language',
    'dir',
    'data-gutter',
  ]);
  expect(rust.getAttribute('data-gutter')).toBe('1');
  expect(rust.hasAttribute('data-highlight-language')).toBe(false);
  expect(pluginEvents.size).toBe(0);
  release();
});

test('numbers each line break child without a code tokenizer', () => {
  const { view, mirror, elements, mutations } = stubView([
    { key: 5, type: 'custom-code', kind: 'element', children: [6] },
    { key: 6, type: 'text', kind: 'text', children: [] },
  ]);
  const release = installNativeCodeChrome(view, { codeHighlighting: false });
  mirror.set(7, { key: 7, type: 'linebreak', kind: 'linebreak', children: [] });
  mirror.set(8, { key: 8, type: 'text', kind: 'text', children: [] });
  mirror.get(5)!.children = [6, 7, 8];
  for (const listener of mutations) listener(new Map([[5, 'updated']]));
  expect(elements.get(5)!.getAttribute('data-gutter')).toBe('1\n2');
  expect(elements.get(5)!.hasAttribute('data-highlight-language')).toBe(false);
  release();
  expect(mutations.size).toBe(0);
});

// Source setIsSyntaxHighlightSupported: a transform run that finds no language
// leaves the block without data-highlight-language once the grammar check loads.
test('keeps a null-language report without data-highlight-language', async () => {
  const { view, elements, pluginEvents } = stubView([
    { key: 5, type: 'custom-code', kind: 'element', children: [6] },
    { key: 6, type: 'text', kind: 'text', children: [] },
  ]);
  const release = installNativeCodeChrome(view, { codeHighlighting: true });
  expect(pluginEvents.size).toBe(1);
  for (const listener of pluginEvents)
    listener({ key: 5, generation: 0, language: null });
  await import('@macro-inc/lexical-wasm-view/view/code-highlight');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const element = elements.get(5)!;
  expect(element.getAttributeNames()).toEqual([
    'spellcheck',
    'dir',
    'data-gutter',
  ]);
  release();
  expect(pluginEvents.size).toBe(0);
});

// Consumer-only: a supplied report, not proof that a session produces one.
test('retains a reported language across a remount and drops it on destroy', async () => {
  const { view, elements, mutations, pluginEvents, remount, dispatch } =
    stubView([
      {
        key: 5,
        type: 'custom-code',
        kind: 'element',
        children: [6],
        language: 'javascript',
      },
      { key: 6, type: 'text', kind: 'text', children: [] },
    ]);
  const release = installNativeCodeChrome(view, { codeHighlighting: true });
  for (const listener of pluginEvents)
    listener({ key: 5, generation: 0, language: 'javascript' });
  await import('@macro-inc/lexical-wasm-view/view/code-highlight');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(elements.get(5)!.getAttributeNames()).toEqual([
    'spellcheck',
    'data-language',
    'dir',
    'data-gutter',
    'data-highlight-language',
  ]);
  expect(elements.get(5)!.getAttribute('data-highlight-language')).toBe(
    'javascript'
  );
  const replaced = remount(5);
  dispatch(5, 'updated');
  expect(replaced.getAttributeNames()).toEqual([
    'spellcheck',
    'data-language',
    'dir',
    'data-gutter',
    'data-highlight-language',
  ]);
  expect(replaced.getAttribute('data-gutter')).toBe('1');
  expect(replaced.getAttribute('data-highlight-language')).toBe('javascript');
  dispatch(5, 'destroyed');
  const created = remount(5);
  dispatch(5, 'created');
  expect(created.getAttributeNames()).toEqual([
    'spellcheck',
    'data-language',
    'dir',
    'data-gutter',
  ]);
  release();
  expect(mutations.size).toBe(0);
  expect(pluginEvents.size).toBe(0);
});

test('releases the gutter and rethrows when the highlight install fails', () => {
  const cause = new Error('report subscription failed');
  const { view, mutations } = stubView(
    [
      { key: 5, type: 'custom-code', kind: 'element', children: [6] },
      { key: 6, type: 'text', kind: 'text', children: [] },
    ],
    { subscribeReports: cause }
  );
  let thrown: unknown;
  try {
    installNativeCodeChrome(view, { codeHighlighting: true });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(cause);
  expect(mutations.size).toBe(0);
});

test('keeps the install failure when the gutter release also fails', () => {
  const cause = new Error('report subscription failed');
  const { view, mutations } = stubView(
    [
      { key: 5, type: 'custom-code', kind: 'element', children: [6] },
      { key: 6, type: 'text', kind: 'text', children: [] },
    ],
    { subscribeReports: cause, releaseMutations: new Error('release failed') }
  );
  let thrown: unknown;
  try {
    installNativeCodeChrome(view, { codeHighlighting: true });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(cause);
  expect(mutations.size).toBe(0);
});
