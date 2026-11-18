import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  createEditor,
  ParagraphNode,
  type TextNode,
} from 'lexical';
import { expect, test, vi } from 'vitest';
import { getUpstreamRuntime } from './test-setup';
import {
  $createTestDecoratorNode,
  TestDecoratorNode,
} from './tests/upstream-fixtures';
import { type CompatCommit, createCompatView } from './view';

for (const count of [64, 1024]) {
  test(`non-suffix edits avoid untouched siblings (${count} blocks)`, () => {
    const editor = createEditor({
      onError(error) {
        throw error;
      },
    });
    editor._headless = true;
    editor._commands.clear();
    const keys: string[] = [];
    editor.update(
      () => {
        for (let i = 0; i < count; i++) {
          const text = $createTextNode(String(i));
          keys.push(text.getKey());
          $getRoot().append($createParagraphNode().append(text));
        }
      },
      { discrete: true }
    );
    const view = createCompatView(editor, getUpstreamRuntime());
    const root = document.createElement('div');
    view.setRootElement(root);
    let commit: CompatCommit | undefined;
    const stop = editor.registerUpdateListener((value) => {
      commit = { ...value, dirtyType: 1 };
    });
    const inline = vi.spyOn(ParagraphNode.prototype, 'isInline');
    const render = (expected: string[]) => {
      if (!commit) throw new Error('Missing real committed update');
      inline.mockClear();
      view.publish(commit, view.reconcile(commit));
      expect(inline.mock.calls.length).toBeLessThan(80);
      expect([...root.children].map((element) => element.textContent)).toEqual(
        expected
      );
      expect(Reflect.get(root, '__lexicalTextContent')).toBe(
        expected.join('\n\n')
      );
    };
    const expected = Array.from({ length: count }, (_, i) => String(i));
    try {
      for (const at of [0, Math.floor(count / 2), 0, Math.floor(count / 2)]) {
        editor.update(
          () => {
            const node = $getNodeByKey<TextNode>(keys[at]);
            if (!node) throw new Error('Missing text');
            expected[at] += '!';
            node.setTextContent(expected[at]);
          },
          { discrete: true }
        );
        render(expected);
      }
      editor.update(
        () => {
          const middle = $getNodeByKey<TextNode>(keys[Math.floor(count / 2)]);
          if (!middle) throw new Error('Missing middle');
          middle
            .getParentOrThrow()
            .insertBefore(
              $createParagraphNode().append($createTextNode('inserted'))
            );
        },
        { discrete: true }
      );
      expected.splice(Math.floor(count / 2), 0, 'inserted');
      render(expected);
      editor.update(
        () => {
          const middle = $getNodeByKey<TextNode>(keys[Math.floor(count / 2)]);
          if (!middle) throw new Error('Missing middle');
          middle.getParentOrThrow().getPreviousSibling()?.remove();
        },
        { discrete: true }
      );
      expected.splice(Math.floor(count / 2), 1);
      render(expected);
      editor.update(
        () => {
          const first = $getNodeByKey<TextNode>(keys[0]);
          const middle = $getNodeByKey<TextNode>(keys[Math.floor(count / 2)]);
          if (!first || !middle) throw new Error('Missing move nodes');
          middle.getParentOrThrow().insertAfter(first.getParentOrThrow());
        },
        { discrete: true }
      );
      const moved = expected.shift();
      if (moved === undefined) throw new Error('Missing expected first');
      expected.splice(Math.floor(count / 2), 0, moved);
      render(expected);
      editor.update(
        () => {
          for (let i = 0; i < 3; i++)
            $getRoot().getFirstChildOrThrow().remove();
        },
        { discrete: true }
      );
      expected.splice(0, 3);
      render(expected);
      editor.update(
        () => {
          $getRoot().clear();
        },
        { discrete: true }
      );
      render([]);
    } finally {
      inline.mockRestore();
      stop();
      view.dispose();
    }
  });
}

test('publication does not enumerate untouched decorators and drops removed entries', () => {
  const editor = createEditor({
    nodes: [TestDecoratorNode],
    onError(error) {
      throw error;
    },
  });
  editor._headless = true;
  editor._commands.clear();
  let textKey = '';
  let decoratorKey = '';
  editor.update(
    () => {
      const text = $createTextNode('text');
      textKey = text.getKey();
      $getRoot().append($createParagraphNode().append(text));
      for (let i = 0; i < 128; i++) {
        const decorator = $createTestDecoratorNode();
        decoratorKey = decorator.getKey();
        $getRoot().append($createParagraphNode().append(decorator));
      }
    },
    { discrete: true }
  );
  const view = createCompatView(editor, getUpstreamRuntime());
  view.setRootElement(document.createElement('div'));
  let commit: CompatCommit | undefined;
  const stop = editor.registerUpdateListener((value) => {
    commit = { ...value, dirtyType: 1 };
  });
  const ownKeys = vi.fn(Reflect.ownKeys);
  const descriptors = vi.fn(Reflect.getOwnPropertyDescriptor);
  // Observe the authentic published object; graph and values stay upstream.
  editor._decorators = new Proxy<Record<string, unknown>>(editor._decorators, {
    ownKeys,
    getOwnPropertyDescriptor: descriptors,
  });
  const decorate = vi.spyOn(TestDecoratorNode.prototype, 'decorate');
  try {
    const previousDecorators = editor.getDecorators();
    editor.update(
      () => {
        const text = $getNodeByKey<TextNode>(textKey);
        if (!text) throw new Error('Missing text');
        text.setTextContent('edited');
      },
      { discrete: true }
    );
    if (!commit) throw new Error('Missing commit');
    ownKeys.mockClear();
    view.publish(commit, view.reconcile(commit));
    expect(ownKeys).not.toHaveBeenCalled();
    expect(decorate).not.toHaveBeenCalled();
    editor.update(
      () => {
        $getNodeByKey(decoratorKey)?.remove();
      },
      { discrete: true }
    );
    if (!commit) throw new Error('Missing removal');
    // The source model performs its own decorator GC. Restore its exact prior
    // object so this test exercises the adapter's destruction path independently.
    editor._decorators = previousDecorators;
    ownKeys.mockClear();
    descriptors.mockClear();
    view.publish(commit, view.reconcile(commit));
    expect(Object.hasOwn(editor.getDecorators(), decoratorKey)).toBe(false);
    expect(Object.keys(editor.getDecorators())).toHaveLength(127);
    expect(ownKeys).toHaveBeenCalledTimes(1);
    expect(descriptors).toHaveBeenCalledTimes(129);
    view.setRootElement(null);
    const unmountedDecorators = editor.getDecorators();
    let removedKey = '';
    editor.update(
      () => {
        const paragraph = $getRoot().getChildAtIndex(1);
        if (!(paragraph instanceof ParagraphNode))
          throw new Error('Missing paragraph');
        const decorator = paragraph.getFirstChildOrThrow();
        removedKey = decorator.getKey();
        paragraph.remove();
      },
      { discrete: true }
    );
    if (!commit) throw new Error('Missing unmounted removal');
    editor._decorators = unmountedDecorators;
    const unmounted = { ...commit, removedNodes: new Set([removedKey]) };
    view.publish(unmounted, view.reconcile(unmounted));
    expect(Object.hasOwn(editor.getDecorators(), removedKey)).toBe(false);
    expect(Object.keys(editor.getDecorators())).toHaveLength(126);
  } finally {
    decorate.mockRestore();
    stop();
    view.dispose();
  }
});

test('later removals remain visible to earlier DOM hooks and mutation entries', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  editor.setRootElement(root);
  let textKey = '';
  let firstKey = '';
  let lastKey = '';
  editor.update(
    () => {
      const first = $createTextNode('a');
      const paragraph = $createParagraphNode().append(first);
      const last = $createParagraphNode().append($createTextNode('c'));
      textKey = first.getKey();
      firstKey = paragraph.getKey();
      lastKey = last.getKey();
      $getRoot()
        .clear()
        .append(
          paragraph,
          $createParagraphNode().append($createTextNode('b')),
          last
        );
    },
    { discrete: true }
  );
  const observations: string[] = [];
  const original = ParagraphNode.prototype.updateDOM;
  const hook = vi
    .spyOn(ParagraphNode.prototype, 'updateDOM')
    .mockImplementation(function (this: ParagraphNode, previous, dom, config) {
      observations.push(dom.parentElement?.textContent ?? 'detached');
      return original.call(this, previous, dom, config);
    });
  const mutationEntries: string[] = [];
  const mutations = editor.registerMutationListener(
    ParagraphNode,
    (changes) => {
      for (const [key, kind] of changes) mutationEntries.push(key + ':' + kind);
    },
    { skipInitialization: true }
  );
  try {
    editor.update(
      () => {
        const text = $getNodeByKey<TextNode>(textKey);
        if (!text) throw new Error('Missing first text');
        text.setTextContent('A');
        text.getParentOrThrow().setIndent(1);
        $getNodeByKey(lastKey)?.remove();
      },
      { discrete: true }
    );
    expect(observations[0]).toBe('abc');
    expect(
      mutationEntries.indexOf(firstKey + ':updated')
    ).toBeGreaterThanOrEqual(0);
    expect(mutationEntries.indexOf(firstKey + ':updated')).toBeLessThan(
      mutationEntries.indexOf(lastKey + ':destroyed')
    );
    expect(root.textContent).toBe('Ab');
  } finally {
    hook.mockRestore();
    mutations();
    editor.setRootElement(null);
  }
});

test('moves and removals preserve pinned hook context and mutation order', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  editor.setRootElement(root);
  const labels = new Map<string, string>();
  const keys: string[] = [];
  editor.update(
    () => {
      for (const label of ['a', 'b', 'c', 'd', 'e']) {
        const paragraph = $createParagraphNode().append($createTextNode(label));
        labels.set(paragraph.getKey(), label);
        keys.push(paragraph.getKey());
        $getRoot().append(paragraph);
      }
    },
    { discrete: true }
  );
  const trace: string[] = [];
  const original = ParagraphNode.prototype.updateDOM;
  const hook = vi
    .spyOn(ParagraphNode.prototype, 'updateDOM')
    .mockImplementation(function (this: ParagraphNode, previous, dom, config) {
      trace.push(
        labels.get(this.getKey()) + ':' + dom.parentElement?.textContent
      );
      return original.call(this, previous, dom, config);
    });
  const entries: string[] = [];
  const stop = editor.registerMutationListener(
    ParagraphNode,
    (changes) => {
      for (const [key, kind] of changes)
        entries.push(labels.get(key) + ':' + kind);
    },
    { skipInitialization: true }
  );
  try {
    editor.update(
      () => {
        const first = $getNodeByKey<ParagraphNode>(keys[0]);
        const second = $getNodeByKey<ParagraphNode>(keys[1]);
        const last = $getNodeByKey<ParagraphNode>(keys[4]);
        if (!first || !second || !last) throw new Error('Missing move fixture');
        first.setIndent(1);
        first.getFirstChildOrThrow<TextNode>().setTextContent('A');
        second.insertBefore(last);
        $getNodeByKey(keys[3])?.remove();
      },
      { discrete: true }
    );
    expect(trace).toEqual(['a:abcde', 'e:Aebcd', 'b:Aebcd', 'c:Aebc']);
    expect(entries).toEqual([
      'a:updated',
      'e:updated',
      'b:updated',
      'd:destroyed',
      'c:updated',
    ]);
    expect(root.textContent).toBe('Aebc');
  } finally {
    hook.mockRestore();
    stop();
    editor.setRootElement(null);
  }
});

for (const reverse of [true, false]) {
  test(`permutation hooks preserve pinned cursor context (${reverse ? 'reverse' : 'long clean gap'})`, () => {
    const editor = createEditor({
      onError(error) {
        throw error;
      },
    });
    const root = document.createElement('div');
    editor.setRootElement(root);
    const names = reverse
      ? ['a', 'b', 'c']
      : ['a', ...Array.from({ length: 62 }, (_, i) => `b${i}`), 'z'];
    const labels = new Map<string, string>();
    editor.update(
      () => {
        for (const name of names) {
          const paragraph = $createParagraphNode().append(
            $createTextNode(name)
          );
          labels.set(paragraph.getKey(), name);
          $getRoot().append(paragraph);
        }
      },
      { discrete: true }
    );
    const trace: string[] = [];
    const original = ParagraphNode.prototype.updateDOM;
    const hook = vi
      .spyOn(ParagraphNode.prototype, 'updateDOM')
      .mockImplementation(function (
        this: ParagraphNode,
        previous,
        dom,
        config
      ) {
        trace.push(
          labels.get(this.getKey()) + ':' + dom.parentElement?.textContent
        );
        return original.call(this, previous, dom, config);
      });
    try {
      editor.update(
        () => {
          const parent = $getRoot();
          if (reverse) parent.append(...parent.getChildren().reverse());
          else parent.append(parent.getFirstChildOrThrow());
        },
        { discrete: true }
      );
      if (reverse) {
        expect(trace).toEqual(['c:cab', 'b:cab', 'a:cba']);
        expect(root.textContent).toBe('cba');
      } else {
        const final = names.slice(1).join('') + 'a';
        expect(trace).toEqual([
          'b0:b0a' + names.slice(2).join(''),
          'z:' + final,
          'a:' + final,
        ]);
        expect(root.textContent).toBe(final);
      }
    } finally {
      hook.mockRestore();
      editor.setRootElement(null);
    }
  });
}

test('deterministic sparse edits preserve pinned hook and mutation traces', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  editor.setRootElement(root);
  const labels = new Map<string, string>();
  editor.update(
    () => {
      for (let i = 0; i < 32; i++) {
        const paragraph = $createParagraphNode().append(
          $createTextNode('p' + i)
        );
        labels.set(paragraph.getKey(), 'p' + i);
        $getRoot().append(paragraph);
      }
    },
    { discrete: true }
  );
  const trace: unknown[] = [];
  const original = ParagraphNode.prototype.updateDOM;
  const hook = vi
    .spyOn(ParagraphNode.prototype, 'updateDOM')
    .mockImplementation(function (this: ParagraphNode, previous, dom, config) {
      trace.push([
        'hook',
        labels.get(this.getKey()),
        dom.parentElement?.textContent,
      ]);
      return original.call(this, previous, dom, config);
    });
  const stop = editor.registerMutationListener(
    ParagraphNode,
    (changes) => {
      trace.push([
        'mutations',
        [...changes].map(([key, kind]) => [labels.get(key), kind]),
      ]);
    },
    { skipInitialization: true }
  );
  let seed = 1729;
  try {
    for (let step = 0; step < 64; step++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      editor.update(
        () => {
          const parent = $getRoot();
          const children = parent.getChildren();
          const a = seed % children.length,
            b = (seed >>> 8) % children.length;
          const node = children[a];
          if (!(node instanceof ParagraphNode))
            throw new Error('Missing paragraph');
          switch (step % 4) {
            case 0:
              if (a !== b) children[b].insertBefore(node);
              break;
            case 1:
              if (children.length > 8) node.remove();
              break;
            case 2: {
              const next = $createParagraphNode().append(
                $createTextNode('x' + step)
              );
              labels.set(next.getKey(), 'x' + step);
              node.insertAfter(next);
              break;
            }
            case 3:
              node.setIndent((step % 3) + 1);
              node.getFirstChildOrThrow<TextNode>().setTextContent('t' + step);
              break;
          }
        },
        { discrete: true }
      );
      trace.push(['dom', step, root.innerHTML]);
    }
    if (process.env.COMPAT_TRACE_OUTPUT)
      writeFileSync(
        process.env.COMPAT_TRACE_OUTPUT,
        JSON.stringify(trace, null, 2)
      );
    // Bound to the unchanged v0.45.0 reconciler; readable ordering cases above
    // cover the individual hook contexts behind this wider deterministic trace.
    expect(
      createHash('sha256').update(JSON.stringify(trace)).digest('hex')
    ).toBe('4d030dff7163c7c8a355b399f2ecfab9fc17344cd9dfc9792c8ee9b60b838c9e');
  } finally {
    hook.mockRestore();
    stop();
    editor.setRootElement(null);
  }
});
