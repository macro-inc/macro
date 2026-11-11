import { CompatNativePrototype } from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { prepareEditorRegisteredNodes } from '../../configuration/registered-nodes';
import { foreignHooks } from '../../hooks.generated';
import { ElementNode, RootNode, TextNode } from '../../nodes';
import { constructorToken } from './constructor-identity';
import { registrations } from './registrations';

// These are real prepared JS classes and generated metadata, not a native
// factory, constructor authorization, hosted callback or initializer fixture.
test('prepared defaults keep true generic Artificial storage and its import hook', () => {
  const prepared = prepareEditorRegisteredNodes({ configOmitted: false });
  const metadata = registrations(7, prepared);
  try {
    expect(metadata.classes.map((row) => row.typeName)).toEqual([
      ...prepared.registeredNodes.keys(),
    ]);
    expect(metadata.classes.every((row) => row.className === '')).toBe(true);
    const root = metadata.classes.find((row) => row.typeName === 'root');
    const artificial = metadata.classes.find(
      (row) => row.typeName === 'artificial'
    );
    if (!root || !artificial) throw new Error('Missing prepared default class');
    expect(metadata.constructors.get(root.classId)).toBe(RootNode);
    expect(
      metadata.hostedClasses.find((row) => row.classId === root.classId)
        ?.constructorToken
    ).toBe(constructorToken(RootNode));
    expect(artificial.nativeType).toBe('');
    expect(
      metadata.hostedClasses.find((row) => row.classId === artificial.classId)
        ?.nativePrototype
    ).toBe(CompatNativePrototype.ElementNode);
    expect(metadata.payloads.get(artificial.classId)).toEqual({
      kind: 'generic-element',
      nativeType: '',
    });
    const hook = foreignHooks.findIndex(
      (row) => row.static && row.name === 'importJSON'
    );
    if (hook < 0) throw new Error('Missing actual importJSON hook');
    expect(artificial.hooks & (1n << BigInt(hook))).not.toBe(0n);
  } finally {
    metadata.registry.dispose();
  }
});

test('captured configured constructors do not reread getType or Function.name', () => {
  class SameNameText extends TextNode {
    static getType(): string {
      return 'text';
    }
  }
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [SameNameText],
  });
  const failure = {};
  Object.defineProperty(SameNameText, 'getType', {
    value() {
      throw failure;
    },
  });
  Object.defineProperty(SameNameText, 'name', {
    get() {
      throw failure;
    },
  });
  const metadata = registrations(8, prepared);
  try {
    const text = metadata.classes.find((row) => row.typeName === 'text');
    const tab = metadata.classes.find((row) => row.typeName === 'tab');
    if (!text || !tab) throw new Error('Missing prepared text classes');
    expect(text.ancestry).toEqual([]);
    expect(tab.ancestry).toEqual([]);
    expect(metadata.constructors.get(text.classId)).toBe(SameNameText);
    expect([...metadata.constructors.values()]).not.toContain(TextNode);
    const token = metadata.hostedClasses.find(
      (row) => row.classId === text.classId
    )?.constructorToken;
    expect(token).toBe(constructorToken(SameNameText));
    expect(token).not.toBe(constructorToken(TextNode));
    expect(
      metadata.classes.filter((row) => row.typeName === 'text')
    ).toHaveLength(1);
  } finally {
    metadata.registry.dispose();
  }
});

test('a generic Element named heading does not acquire a native Heading descriptor', () => {
  class GenericHeading extends ElementNode {
    static getType(): string {
      return 'heading';
    }
  }
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [GenericHeading],
  });
  const metadata = registrations(9, prepared);
  try {
    const row = metadata.classes.find((entry) => entry.typeName === 'heading');
    if (!row) throw new Error('Missing configured generic Element');
    expect(row.nativeType).toBe('');
    expect(metadata.constructors.get(row.classId)).toBe(GenericHeading);
    expect(
      metadata.hostedClasses.find((entry) => entry.classId === row.classId)
        ?.nativePrototype
    ).toBe(CompatNativePrototype.ElementNode);
  } finally {
    metadata.registry.dispose();
  }
});

test('unsupported storage and invalid owner IDs reject instead of guessing a baseline', () => {
  class CustomText extends TextNode {
    static getType(): string {
      return 'custom-text';
    }
  }
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [CustomText],
  });
  expect(() => registrations(10, prepared)).toThrow(
    'does not support this configured type name'
  );
  expect(() => registrations(0, prepared)).toThrow('editor identity');
  expect(() => registrations(0x1_0000_0000, prepared)).toThrow(
    'editor identity'
  );
});

test('type names stay paired with their own map entries after insertion order changes', () => {
  class First extends ElementNode {
    static getType(): string {
      return 'first';
    }
  }
  class Second extends ElementNode {
    static getType(): string {
      return 'second';
    }
  }
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [First, Second],
  });
  const row = prepared.registeredNodes.get('first');
  if (!row) throw new Error('Missing prepared class');
  prepared.registeredNodes.delete('first');
  prepared.registeredNodes.set('first', row);
  const metadata = registrations(11, prepared);
  try {
    const first = metadata.classes.find((entry) => entry.typeName === 'first');
    const second = metadata.classes.find(
      (entry) => entry.typeName === 'second'
    );
    if (!first || !second) throw new Error('Missing configured class metadata');
    expect(metadata.constructors.get(first.classId)).toBe(First);
    expect(metadata.constructors.get(second.classId)).toBe(Second);
  } finally {
    metadata.registry.dispose();
  }
});

test('the producer preserves accessor capabilities without running user code', () => {
  class AccessorElement extends ElementNode {
    static getType(): string {
      return 'accessor-element';
    }
  }
  let reads = 0;
  const failure = {};
  Object.defineProperty(AccessorElement.prototype, 'getIndent', {
    configurable: true,
    get() {
      reads++;
      throw failure;
    },
  });
  const prepared = prepareEditorRegisteredNodes({
    configOmitted: false,
    nodes: [AccessorElement],
  });
  const metadata = registrations(12, prepared);
  try {
    const row = metadata.classes.find(
      (entry) => entry.typeName === 'accessor-element'
    );
    const hook = foreignHooks.findIndex(
      (entry) => !entry.static && entry.name === 'getIndent'
    );
    if (!row || hook < 0) throw new Error('Missing actual configured hook');
    expect(reads).toBe(0);
    expect(row.hooks & (1n << BigInt(hook))).not.toBe(0n);
  } finally {
    metadata.registry.dispose();
  }
});
