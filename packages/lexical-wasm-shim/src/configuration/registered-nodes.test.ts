import { expect, test } from 'vitest';
import { ArtificialNode__DO_NOT_USE } from '../nodes/artificial';
import type { LexicalNode } from '../nodes/base';
import { LineBreakNode, ParagraphNode, RootNode } from '../nodes/builtins';
import { ElementNode } from '../nodes/element';
import type {
  ClassLike,
  NodeDOMExport,
  RegisteredNodes,
} from '../nodes/replacement/types';
import { createState } from '../nodes/state/config';
import { TabNode } from '../nodes/tab';
import { TextNode } from '../nodes/text';
import { prepareEditorRegisteredNodes } from './registered-nodes';

test('default registry uses the pinned classes and a real generic Element ArtificialNode', () => {
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: true,
    inheritedRegistry: null,
  });
  const defaults = [
    RootNode,
    TextNode,
    LineBreakNode,
    TabNode,
    ParagraphNode,
    ArtificialNode__DO_NOT_USE,
  ];
  expect(prepared.nodeConfigs).toEqual(defaults);
  expect(prepared.nodeClasses).toEqual(defaults);
  expect([...prepared.registeredNodes.keys()]).toEqual([
    'root',
    'text',
    'linebreak',
    'tab',
    'paragraph',
    'artificial',
  ]);
  expect(ArtificialNode__DO_NOT_USE.prototype).toBeInstanceOf(ElementNode);
  expect(ArtificialNode__DO_NOT_USE.prototype).not.toBeInstanceOf(
    ParagraphNode
  );
  expect(ArtificialNode__DO_NOT_USE.getType()).toBe('artificial');
  expect(Object.hasOwn(ArtificialNode__DO_NOT_USE, 'clone')).toBe(true);
  expect(Object.hasOwn(ArtificialNode__DO_NOT_USE, 'importJSON')).toBe(true);
});

test('only omitted configuration reuses the supplied real metadata map', () => {
  let configReads = 0;
  class Custom extends TextNode {
    $config() {
      configReads++;
      return this.config('prepared-custom', { extends: TextNode });
    }
  }
  const original = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [Custom],
  });
  const before = configReads;
  const inherited = prepareEditorRegisteredNodes({
    configOmitted: true,
    inheritedRegistry: original.registeredNodes,
  });
  expect(inherited.registeredNodes).toBe(original.registeredNodes);
  expect(inherited.nodeClasses).toEqual(original.nodeClasses);
  expect(configReads).toBe(before);
  const explicit: { configOmitted: false; inheritedRegistry: RegisteredNodes } =
    { configOmitted: false, inheritedRegistry: original.registeredNodes };
  const fresh = prepareEditorRegisteredNodes(explicit);
  expect(fresh.registeredNodes).not.toBe(original.registeredNodes);
  expect(fresh.registeredNodes.has('prepared-custom')).toBe(false);
  expect(fresh.registeredNodes.get('text')).not.toBe(
    original.registeredNodes.get('text')
  );
});

test('preparation interleaves getter snapshots and full factory work and excludes hidden replacement classes', () => {
  const events: string[] = [];
  const state = createState('prepared-state', { parse: () => 0 });
  class First extends TextNode {
    $config() {
      events.push('prepare-first');
      return this.config('prepare-first', {
        extends: TextNode,
        stateConfigs: [state],
      });
    }
  }
  class Hidden extends First {}
  class Second extends TextNode {
    $config() {
      events.push('prepare-second');
      return this.config('prepare-second', { extends: TextNode });
    }
  }
  const first = {
    get replace() {
      events.push('first.replace');
      return First;
    },
    get with() {
      events.push('first.with');
      return (node: LexicalNode) => node;
    },
    get withKlass() {
      events.push('first.withKlass');
      return Hidden;
    },
  };
  const second = {
    get replace() {
      events.push('second.replace');
      return Second;
    },
    get with() {
      events.push('second.with');
      return (node: LexicalNode) => node;
    },
    get withKlass() {
      events.push('second.withKlass');
      return undefined;
    },
  };
  const exporter: NodeDOMExport = () => ({ element: null });
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [first, second],
    exportDOM: new Map<ClassLike, NodeDOMExport>([[First, exporter]]),
  });
  expect(events.filter((event) => event.includes('.'))).toEqual([
    'first.replace',
    'first.with',
    'first.withKlass',
    'second.replace',
    'second.with',
    'second.withKlass',
  ]);
  expect(events.lastIndexOf('prepare-first')).toBeLessThan(
    events.indexOf('second.replace')
  );
  expect(prepared.nodeClasses).toContain(First);
  expect(prepared.nodeClasses).toContain(Second);
  expect(prepared.nodeClasses).not.toContain(Hidden);
  expect(Object.hasOwn(Hidden, 'clone')).toBe(false);
  expect(prepared.registeredNodes.get('prepare-first')?.exportDOM).toBe(
    exporter
  );
  expect(
    prepared.registeredNodes
      .get('prepare-first')
      ?.sharedNodeState.sharedConfigMap.get('prepared-state')
  ).toBe(state);
});
