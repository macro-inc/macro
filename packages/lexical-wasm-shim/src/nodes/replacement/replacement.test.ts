import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import type { LexicalNode } from '../base';
import { ParagraphNode } from '../builtins';
import { createState } from '../state/config';
import { TabNode } from '../tab';
import { TextNode } from '../text';
import {
  $applyNodeReplacement,
  $create,
  bindReplacement,
  buildRegisteredNodes,
  getTransformSetFromKlass,
} from './index';

test('class-specific replacement callback has a real runtime constructor witness', () => {
  const editor = createEditor({
    namespace: 'replacement witness',
    onError: (error) => {
      throw error;
    },
  });
  let calls = 0;
  const bound = bindReplacement({
    replace: TextNode,
    withKlass: TabNode,
    with: (node: TextNode) => {
      calls++;
      return new TabNode().setFormat(node.getFormat());
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('source').setFormat('bold');
        const paragraph = new ParagraphNode().append(text);
        $getRoot().append(paragraph);
        const replacement = bound.with(text);
        expect(replacement).toBeInstanceOf(TabNode);
        if (!(replacement instanceof TabNode))
          throw new Error('expected actual TabNode');
        expect(replacement.getFormat()).toBe(1);
        expect(calls).toBe(1);
        expect(() => bound.with(paragraph)).toThrow(
          'must be an instance of TextNode'
        );
        expect(calls).toBe(1);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('registered metadata preserves callback/export identities and never registers hidden withKlass', () => {
  let hiddenConfigReads = 0;
  class Hidden extends TextNode {
    $config() {
      hiddenConfigReads++;
      return this.config('hidden-replacement', { extends: TextNode });
    }
  }
  const bound = bindReplacement({
    replace: TextNode,
    with: (node: TextNode) => node,
    withKlass: Hidden,
  });
  const exportDOM = () => ({ element: null });
  const registered = buildRegisteredNodes(
    [TextNode, bound],
    new Map([[TextNode, exportDOM]])
  );
  expect([...registered.keys()]).toEqual(['text']);
  const text = registered.get('text');
  expect(text?.klass).toBe(TextNode);
  expect(text?.replace).toBe(bound.with);
  expect(text?.replaceWithKlass).toBe(Hidden);
  expect(text?.exportDOM).toBe(exportDOM);
  expect(hiddenConfigReads).toBe(0);
  expect(Object.hasOwn(Hidden, 'clone')).toBe(false);
  const fresh = buildRegisteredNodes([bound]);
  expect(fresh.get('text')?.sharedNodeState).not.toBe(text?.sharedNodeState);
  expect(fresh.get('text')?.transforms).not.toBe(text?.transforms);
});

test('transform collection deduplicates static method identity and keeps actual config inheritance order', () => {
  const receivers: string[] = [];
  const staticTransform = (_node: LexicalNode) => {};
  const childTransform = (_node: LexicalNode) => {};
  const parentTransform = (_node: LexicalNode) => {};
  const state = createState('replacement-state', { parse: () => 0 });
  class Parent extends TextNode {
    static transform() {
      receivers.push(this.name);
      return staticTransform;
    }
    $config() {
      return this.config('transform-parent', {
        extends: TextNode,
        $transform: parentTransform,
        stateConfigs: [state],
      });
    }
  }
  class Child extends Parent {
    $config() {
      return this.config('transform-child', {
        extends: Parent,
        $transform: childTransform,
      });
    }
  }
  expect([...getTransformSetFromKlass(Child)]).toEqual([
    staticTransform,
    childTransform,
    parentTransform,
  ]);
  expect(receivers).toEqual(['Child']);
  const registered = buildRegisteredNodes([Child]);
  expect(
    registered
      .get('transform-child')
      ?.sharedNodeState.sharedConfigMap.get('replacement-state')
  ).toBe(state);
  expect(receivers).toEqual(['Child', 'Child']);
});

test('replacement validation and active registry guards match upstream', () => {
  const bound = bindReplacement({
    replace: TextNode,
    with: (node: TextNode) => node,
    withKlass: ParagraphNode,
  });
  expect(() => buildRegisteredNodes([bound])).toThrow(
    "doesn't extend the TextNode"
  );
  expect(() => $create(TextNode)).toThrow('Unable to find an active editor');
  const editor = createEditor({
    namespace: 'replacement active registry',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const node = new TextNode('source');
        expect($applyNodeReplacement(node)).toBe(node);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('configured transform accessors are sampled once before following extends', () => {
  const first = (_node: LexicalNode) => {};
  const second = (_node: LexicalNode) => {};
  const observations: string[] = [];
  let reads = 0;
  class Dynamic extends TextNode {
    $config() {
      return {
        'dynamic-transform': {
          get $transform() {
            observations.push('transform');
            return ++reads === 1 ? first : second;
          },
          get extends() {
            observations.push('extends');
            return TextNode;
          },
        },
      };
    }
  }
  expect([...getTransformSetFromKlass(Dynamic)]).toEqual([first]);
  expect(reads).toBe(1);
  expect(observations).toEqual(['transform', 'extends']);
});

test('replacement binder keeps actual class identity and rejects invalid callback results', () => {
  const options = { replace: TextNode, with: (node: TextNode) => node };
  Reflect.set(options, 'with', () => null);
  const bound = bindReplacement(options);
  expect(bound.replace).toBe(TextNode);
  const editor = createEditor({
    namespace: 'replacement public boundary',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const source = new TextNode('source');
        expect(() => bound.with(source)).toThrow(
          'must return a node from this core'
        );
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('replacement class normalization returns the same constructor it validated', () => {
  class Expected extends TextNode {}
  class Different extends TextNode {}
  let reads = 0;
  Object.defineProperty(Expected.prototype, 'constructor', {
    configurable: true,
    get: () => (++reads === 1 ? Expected : Different),
  });
  const bound = bindReplacement({
    replace: Expected,
    with: (node: Expected) => node,
  });
  expect(reads).toBe(1);
  expect(bound.replace).toBe(Expected);
});
