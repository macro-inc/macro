import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { LexicalNode } from '../base';
import { DecoratorNode, ParagraphNode } from '../builtins';
import type { DOMConversionMap } from '../dom-types';
import { ElementNode } from '../element';
import { createState } from '../state/config';
import { TextNode } from '../text';
import {
  createSharedNodeState,
  getPendingNodeToClone,
  getStaticNodeConfig,
  setPendingNodeToClone,
} from './index';

test('static preparation installs configured factories and preserves explicit overrides', () => {
  const dom: DOMConversionMap = { span: () => null };
  class Configured extends TextNode {
    $config() {
      return {
        'configured-factory': {
          extends: TextNode,
          importDOM: dom,
          $importJSON: () => new TextNode('configured import'),
        },
      };
    }
  }
  const prepared = getStaticNodeConfig(Configured);
  expect(prepared.ownNodeType).toBe('configured-factory');
  expect(prepared.ownNodeConfig?.importDOM).toBe(dom);
  expect(Object.hasOwn(Configured, 'getType')).toBe(true);
  expect(Object.hasOwn(Configured, 'clone')).toBe(true);
  expect(Configured.getType()).toBe('configured-factory');
  expect(Configured.importDOM?.()).toBe(dom);
  expect(Configured.importJSON).toBe(prepared.ownNodeConfig?.$importJSON);
  const editor = createEditor({
    namespace: 'configured factory',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        expect(
          Configured.importJSON({
            type: 'configured-factory',
            version: 1,
            text: '',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          }).getTextContent()
        ).toBe('configured import');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }

  class Explicit extends Configured {
    static getType() {
      return 'explicit-factory';
    }
    static clone(previous: TextNode) {
      return previous;
    }
    static importJSON() {
      return new TextNode('explicit import');
    }
    static importDOM() {
      return null;
    }
  }
  const explicit = [
    Explicit.getType,
    Explicit.clone,
    Explicit.importJSON,
    Explicit.importDOM,
  ];
  expect(getStaticNodeConfig(Explicit)).toEqual({
    ownNodeType: 'explicit-factory',
    ownNodeConfig: undefined,
  });
  expect([
    Explicit.getType,
    Explicit.clone,
    Explicit.importJSON,
    Explicit.importDOM,
  ]).toEqual(explicit);
});

test('default clone publishes the real source token before the constructor and consumes once', () => {
  class DefaultClone extends TextNode {
    $config() {
      return this.config('default-clone-factory', { extends: TextNode });
    }
  }
  getStaticNodeConfig(DefaultClone);
  const editor = createEditor({
    namespace: 'clone token',
    onError: (error) => {
      throw error;
    },
  });
  let source: TextNode | undefined;
  try {
    editor.update(
      () => {
        source = new TextNode('source');
        $getRoot().append(new ParagraphNode().append(source));
      },
      { discrete: true }
    );
    if (!source) throw new Error('source was not constructed');
    const sourceNode = source;
    expect(() => DefaultClone.clone(sourceNode)).toThrow(
      'requires an active editor'
    );
    expect(getPendingNodeToClone()).toBe(source);
    expect(getPendingNodeToClone()).toBeNull();
    setPendingNodeToClone(source);
    setPendingNodeToClone(null);
    expect(getPendingNodeToClone()).toBeNull();
  } finally {
    setPendingNodeToClone(null);
    editor.dispose();
  }
});

test('default importJSON constructs the real class and calls its updateFromJSON', () => {
  const descriptor = Object.getOwnPropertyDescriptor(TextNode, 'importJSON');
  if (!descriptor) throw new Error('missing original TextNode importJSON');
  const editor = createEditor({
    namespace: 'default import factory',
    onError: (error) => {
      throw error;
    },
  });
  try {
    Reflect.deleteProperty(TextNode, 'importJSON');
    getStaticNodeConfig(TextNode);
    editor.update(
      () => {
        const node = TextNode.importJSON({
          type: 'text',
          version: 1,
          text: 'imported',
          format: 1,
          detail: 0,
          mode: 'normal',
          style: 'color: red',
        });
        expect(node).toBeInstanceOf(TextNode);
        expect(node.getTextContent()).toBe('imported');
        expect(node.getFormat()).toBe(1);
        expect(node.getStyle()).toBe('color: red');
      },
      { discrete: true }
    );
  } finally {
    Object.defineProperty(TextNode, 'importJSON', descriptor);
    editor.dispose();
  }
});

test('shared state prepares each actual ancestor and preserves concrete-to-parent overwrite order', () => {
  const child = createState('collision', { parse: () => 'child' });
  const parent = createState('collision', { parse: () => 'parent' });
  const own = createState('own', { parse: () => 0 });
  class Parent extends TextNode {
    $config() {
      return this.config('state-parent', {
        extends: TextNode,
        stateConfigs: [parent],
      });
    }
  }
  class Child extends Parent {
    $config() {
      return this.config('state-child', {
        extends: Parent,
        stateConfigs: [{ stateConfig: child, flat: true }, own],
      });
    }
  }
  const shared = createSharedNodeState({ replace: Child });
  expect(shared.sharedConfigMap.get('collision')).toBe(parent);
  expect(shared.sharedConfigMap.get('own')).toBe(own);
  expect([...shared.sharedConfigMap.keys()]).toEqual(['collision', 'own']);
  expect([...shared.flatKeys]).toEqual(['collision']);
  expect(Object.hasOwn(Child, 'clone')).toBe(true);
  expect(Object.hasOwn(Parent, 'clone')).toBe(true);
  expect(Child.getType()).toBe('state-child');
  expect(Parent.getType()).toBe('state-parent');
  const fresh = createSharedNodeState(Child);
  expect(fresh).not.toBe(shared);
  expect([...fresh.sharedConfigMap]).toEqual([...shared.sharedConfigMap]);
});

test('abstract classes keep factory ownership and required constructor checks match upstream', () => {
  for (const klass of [LexicalNode, ElementNode, DecoratorNode]) {
    const own = Object.getOwnPropertyDescriptors(klass);
    getStaticNodeConfig(klass);
    expect(Object.getOwnPropertyDescriptors(klass)).toEqual(own);
  }
  class Required extends TextNode {
    constructor(value: string) {
      super(value.trim());
    }
    $config() {
      return this.config('required-factory', { extends: TextNode });
    }
  }
  expect(() => getStaticNodeConfig(Required)).toThrow(
    'must implement a static clone'
  );
  expect(Object.hasOwn(Required, 'getType')).toBe(true);
  expect(Object.hasOwn(Required, 'clone')).toBe(false);
  class OwnClone extends Required {
    constructor(value: string) {
      super(value.trim());
    }
    static clone(previous: TextNode) {
      return previous;
    }
  }
  expect(() => getStaticNodeConfig(OwnClone)).toThrow(
    'must implement a static importJSON'
  );
});

test('config selection uses own getType or the last record entry and preparation is stable', () => {
  const first = { importDOM: { first: () => null } };
  const last = { importDOM: { last: () => null } };
  class Multiple extends TextNode {
    $config() {
      return { first, last };
    }
  }
  expect(getStaticNodeConfig(Multiple)).toEqual({
    ownNodeType: 'last',
    ownNodeConfig: last,
  });
  const methods = [
    Multiple.getType,
    Multiple.clone,
    Multiple.importJSON,
    Multiple.importDOM,
  ];
  getStaticNodeConfig(Multiple);
  expect([
    Multiple.getType,
    Multiple.clone,
    Multiple.importJSON,
    Multiple.importDOM,
  ]).toEqual(methods);
  class Selected extends TextNode {
    static getType() {
      return 'first';
    }
    $config() {
      return { first, last };
    }
  }
  expect(getStaticNodeConfig(Selected)).toEqual({
    ownNodeType: 'first',
    ownNodeConfig: first,
  });
  expect(Selected.importDOM?.()).toBe(first.importDOM);
});
