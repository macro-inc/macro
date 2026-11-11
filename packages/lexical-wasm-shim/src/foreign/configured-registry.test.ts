import { expect, test } from 'vitest';
import { prepareEditorRegisteredNodes } from '../configuration/registered-nodes';
import { foreignHooks } from '../hooks.generated';
import { LineBreakNode, ParagraphNode, RootNode } from '../nodes/builtins';
import { ElementNode } from '../nodes/element';
import { TabNode } from '../nodes/tab';
import { TextNode } from '../nodes/text';
import { ForeignClassRegistry, NativeNodeCatalog } from './registry';

test('prepared SameNameText replaces the catalog name without rereading getType or adding hidden Text ancestry', () => {
  const catalog = new NativeNodeCatalog([
    { klass: RootNode, kind: 'Root', type: 'root' },
    { klass: ElementNode, kind: 'Element', type: null },
    { klass: TextNode, kind: 'Text', type: 'text' },
    { klass: TabNode, kind: 'Text', type: 'tab' },
    { klass: ParagraphNode, kind: 'Element', type: 'paragraph' },
    { klass: LineBreakNode, kind: 'LineBreak', type: 'linebreak' },
  ]);
  let reads = 0;
  class SameNameText extends TextNode {
    static getType() {
      reads++;
      return 'text';
    }
  }
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [SameNameText],
  });
  const rows = [...prepared.registeredNodes].map(([type, { klass }]) => ({
    klass,
    type,
  }));
  expect(() => new ForeignClassRegistry(catalog, [SameNameText])).toThrow(
    'duplicate node type text'
  );
  const capturedReads = reads;
  const failure = { reason: 'getType was already captured' };
  Object.defineProperty(SameNameText, 'getType', {
    get() {
      reads++;
      throw failure;
    },
  });
  const registry = ForeignClassRegistry.fromConfigured(catalog, rows);
  try {
    const result = registry.beforeUpdate();
    expect(result.map(({ klass }) => klass)).toEqual(
      rows.map(({ klass }) => klass)
    );
    expect(result.some(({ klass }) => klass === TextNode)).toBe(false);
    const text = result.find(({ type }) => type === 'text');
    const tab = result.find(({ type }) => type === 'tab');
    expect(text?.klass).toBe(SameNameText);
    expect(text?.native).toBe(TextNode);
    expect(text?.ancestry).toEqual([]);
    expect(text?.extends).toBeNull();
    expect(tab?.native).toBe(TabNode);
    expect(tab?.ancestry).toEqual([]);
    expect(tab?.extends).toBeNull();
    const importer = foreignHooks.findIndex(
      (hook) => hook.static && hook.name === 'importJSON'
    );
    if (importer < 0) throw new Error('missing static import hook');
    expect(text?.overrides).toBe(1n << BigInt(importer));
    expect(registry.rows()).toBe(result);
    expect(reads).toBe(capturedReads);
  } finally {
    registry.dispose();
  }
});

test('configured foreign ancestry skips hidden constructors but retains configured parents in actual chain order', () => {
  class Parent extends ElementNode {
    static getType() {
      return 'parent';
    }
  }
  class Hidden extends Parent {
    static getType() {
      return 'hidden';
    }
  }
  class Child extends Hidden {
    static getType() {
      return 'child';
    }
  }
  const catalog = new NativeNodeCatalog([
    { klass: ElementNode, kind: 'Element', type: null },
    { klass: Hidden, kind: 'Element', type: 'hidden' },
  ]);
  const registry = ForeignClassRegistry.fromConfigured(catalog, [
    { klass: Child, type: 'captured-child' },
    { klass: Parent, type: 'captured-parent' },
  ]);
  try {
    const [child, parent] = registry.rows();
    expect(child.ancestry).toEqual(['captured-parent']);
    expect(child.extends).toBe('captured-parent');
    expect(child.native).toBe(Hidden);
    expect(parent.ancestry).toEqual([]);
    expect(parent.extends).toBeNull();
    expect(parent.native).toBe(ElementNode);
  } finally {
    registry.dispose();
  }
});

test('a matching catalog type name does not choose the native baseline or authorize hidden classes', () => {
  class CatalogHeading extends ElementNode {
    static getType() {
      return 'heading';
    }
  }
  class NamedHeading extends ElementNode {
    static getType() {
      return 'heading';
    }
  }
  const catalog = new NativeNodeCatalog([
    { klass: ElementNode, kind: 'Element', type: null },
    { klass: CatalogHeading, kind: 'Element', type: 'heading' },
  ]);
  const registry = ForeignClassRegistry.fromConfigured(catalog, [
    { klass: NamedHeading, type: 'heading' },
  ]);
  try {
    const [row] = registry.rows();
    expect(catalog.nativeType('heading')).toBe(CatalogHeading);
    expect(row.native).toBe(ElementNode);
    expect(row.klass).toBe(NamedHeading);
    expect(row.kind).toBe('Element');
    expect(row.ancestry).toEqual([]);
    expect(row.extends).toBeNull();
    expect(registry.rows()).toHaveLength(1);
  } finally {
    registry.dispose();
  }
});

test('configured validation rejects duplicate classes/types and empty names without installing traps', () => {
  class First extends ElementNode {}
  class Second extends ElementNode {}
  const catalog = new NativeNodeCatalog([
    { klass: ElementNode, kind: 'Element', type: null },
  ]);
  const before = Object.getOwnPropertyDescriptors(First.prototype);
  expect(() =>
    ForeignClassRegistry.fromConfigured(catalog, [
      { klass: First, type: 'first' },
      { klass: First, type: 'second' },
    ])
  ).toThrow('duplicate configured node class');
  expect(() =>
    ForeignClassRegistry.fromConfigured(catalog, [
      { klass: First, type: 'same' },
      { klass: Second, type: 'same' },
    ])
  ).toThrow('duplicate configured node type same');
  expect(() =>
    ForeignClassRegistry.fromConfigured(catalog, [{ klass: First, type: '' }])
  ).toThrow('configured node type must be a nonempty string');
  expect(() =>
    ForeignClassRegistry.fromConfigured(catalog, [
      { klass: ElementNode, type: 'abstract' },
    ])
  ).toThrow('abstract native bases cannot be registered');
  expect(Object.getOwnPropertyDescriptors(First.prototype)).toEqual(before);
  const empty = ForeignClassRegistry.fromConfigured(catalog, []);
  try {
    expect(empty.rows()).toEqual([]);
    expect(Object.isFrozen(empty.rows())).toBe(true);
  } finally {
    empty.dispose();
  }
});

test('missing-baseline diagnostics use the captured type even when static getType access throws', () => {
  class Uncatalogued extends ElementNode {}
  let reads = 0;
  const failure = { reason: 'legacy getType access' };
  Object.defineProperty(Uncatalogued, 'getType', {
    get() {
      reads++;
      throw failure;
    },
  });
  const catalog = new NativeNodeCatalog([]);
  expect(() =>
    ForeignClassRegistry.fromConfigured(catalog, [
      { klass: Uncatalogued, type: 'captured-missing' },
    ])
  ).toThrow('node captured-missing has no native ancestor');
  expect(reads).toBe(0);
  let caught: unknown;
  try {
    catalog.nearest(Uncatalogued);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
  expect(reads).toBe(1);
});

test('configured masks retain prototype traps, reset semantics and late-hook refusal', () => {
  class Custom extends ElementNode {
    static getType() {
      return 'configured-hooks';
    }
  }
  const catalog = new NativeNodeCatalog([
    { klass: ElementNode, kind: 'Element', type: null },
  ]);
  const registry = ForeignClassRegistry.fromConfigured(catalog, [
    { klass: Custom, type: 'configured-hooks' },
  ]);
  const index = foreignHooks.findIndex((hook) => hook.name === 'isInline');
  if (index < 0) throw new Error('missing isInline hook');
  const inline = 1n << BigInt(index);
  try {
    expect(registry.rows()[0].overrides).toBe(0n);
    Custom.prototype.isInline = () => true;
    expect(registry.beforeUpdate()[0].overrides).toBe(inline);
    Custom.prototype.isInline = ElementNode.prototype.isInline;
    expect(registry.rows()[0].overrides).toBe(0n);
    expect(() => {
      Custom.prototype.isInline = () => true;
    }).toThrow('native hook isInline');
    expect(Custom.prototype.isInline).toBe(ElementNode.prototype.isInline);
    expect(registry.rows()[0].overrides).toBe(0n);
  } finally {
    registry.dispose();
  }
});

test('legacy and configured registries sharing a real prototype validate patches atomically', () => {
  class Shared extends ElementNode {
    static getType() {
      return 'shared-configured';
    }
  }
  const catalog = new NativeNodeCatalog([
    { klass: ElementNode, kind: 'Element', type: null },
  ]);
  const legacy = new ForeignClassRegistry(catalog, [Shared]);
  const configured = ForeignClassRegistry.fromConfigured(catalog, [
    { klass: Shared, type: 'shared-configured' },
  ]);
  try {
    legacy.beforeUpdate();
    expect(() => {
      Shared.prototype.isInline = () => true;
    }).toThrow('native hook isInline');
    expect(legacy.rows()[0].overrides).toBe(0n);
    expect(configured.rows()[0].overrides).toBe(0n);
    legacy.dispose();
    Shared.prototype.isInline = () => true;
    expect(configured.beforeUpdate()[0].overrides).not.toBe(0n);
  } finally {
    legacy.dispose();
    configured.dispose();
  }
});
