import { expect, test } from 'vitest';
import { ConformanceBackend, diagnostics } from '../../backend/conformance';
import {
  type LexicalNode,
  nativeNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
} from '../index';
import { NodeRuntime, withNodeRuntime } from '../runtime';

test('graph reads preserve identities and node-keyed maps without native crossings', () => {
  const backend = new ConformanceBackend({ namespace: 'node graph' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const root = runtime.call('lexical.$getRoot', []);
      if (!(root instanceof RootNode)) throw new Error('expected root');
      const paragraph = new ParagraphNode();
      const first = new TextNode('first').toggleUnmergeable();
      const second = new TextNode('second').toggleUnmergeable();
      paragraph.append(first, second);
      root.append(paragraph);
      const currentRoot = root.getLatest();
      const owners = new Map<LexicalNode, string>([
        [paragraph, 'paragraph'],
        [first, 'first'],
        [second, 'second'],
      ]);
      const before = diagnostics.crossings();
      expect(first.getParent()).toBe(paragraph);
      expect(first.getParentOrThrow()).toBe(paragraph);
      expect(first.getTopLevelElement()).toBe(paragraph);
      expect(first.getParents()).toEqual([paragraph, currentRoot]);
      expect(first.getParentKeys()).toEqual([paragraph.getKey(), 'root']);
      expect(first.getNextSibling()).toBe(second);
      expect(second.getPreviousSibling()).toBe(first);
      expect(second.getPreviousSiblings()).toEqual([first]);
      expect(first.getNextSiblings()).toEqual([second]);
      expect(first.getIndexWithinParent()).toBe(0);
      expect(second.getIndexWithinParent()).toBe(1);
      expect(first.getCommonAncestor(second)).toBe(paragraph);
      expect(first.isBefore(second)).toBe(true);
      expect(paragraph.isBefore(first)).toBe(false);
      expect(first.isBefore(paragraph)).toBe(true);
      expect(first.isAttached()).toBe(true);
      expect(paragraph.getChildren()).toEqual([first, second]);
      expect(paragraph.getFirstDescendant()).toBe(first);
      expect(paragraph.getLastDescendant()).toBe(second);
      expect(paragraph.getDescendantByIndex(99)).toBe(second);
      expect(paragraph.getAllTextNodes()).toEqual([first, second]);
      expect(paragraph.getTextContent()).toBe('firstsecond');
      expect(paragraph.getTextContentSize()).toBe(11);
      expect(owners.get(paragraph.getFirstChildOrThrow())).toBe('first');
      expect(root.getLatest()).toBe(currentRoot);
      expect(diagnostics.crossings() - before).toBe(0);
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});

test('tab mutation restrictions and root structural restrictions match built-in semantics', () => {
  const backend = new ConformanceBackend({ namespace: 'node restrictions' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const tab = new TabNode();
      expect(tab.getTextContent()).toBe('\t');
      expect(tab.isUnmergeable()).toBe(true);
      expect(tab.canInsertTextBefore()).toBe(false);
      expect(tab.canInsertTextAfter()).toBe(false);
      expect(tab.setTextContent('')).toBe(tab);
      expect(tab.spliceText(0, 0, '')).toBe(tab);
      expect(tab.setDetail(2)).toBe(tab);
      expect(tab.setMode('normal')).toBe(tab);
      expect(() => tab.setTextContent('x')).toThrow(
        'TabNode does not support setTextContent'
      );
      expect(() => tab.setDetail(0)).toThrow(
        'TabNode does not support setDetail'
      );
      expect(() => tab.setMode('token')).toThrow(
        'TabNode does not support setMode'
      );
      const root = runtime.call('lexical.$getRoot', []);
      if (!(root instanceof RootNode)) throw new Error('expected root');
      expect(() => root.remove()).toThrow(
        'remove: cannot be called on root nodes'
      );
      expect(() => root.replace(tab)).toThrow(
        'replace: cannot be called on root nodes'
      );
      expect(() => root.append(tab)).toThrow('Only element or decorator nodes');
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});
