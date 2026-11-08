import { describe, expect, it, vi } from 'vitest';
import { foreignHookIndex } from '../backend/conformance';
import { ForeignClassRegistry, NativeNodeCatalog } from '../foreign/registry';

// These are registry inputs, not a second editor model. The WASM-backed setup
// verifies the generated hook order before these prototype observations run.
describe('foreign prototype registration', () => {
  it('keeps registered ancestry through native bases and inherits JS override bits', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
      canBeEmpty() {
        return true;
      }
    }
    class Paragraph extends Element {
      static getType() {
        return 'paragraph';
      }
    }
    class P2 extends Paragraph {
      static getType() {
        return 'p2';
      }
      isInline() {
        return true;
      }
    }
    class P3 extends P2 {
      static getType() {
        return 'p3';
      }
      canBeEmpty() {
        return false;
      }
    }
    const catalog = new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
      { klass: Paragraph, kind: 'Element' },
    ]);
    const registry = new ForeignClassRegistry(catalog, [
      P3,
      Element,
      P2,
      Paragraph,
    ]);
    const inline = 1n << BigInt(foreignHookIndex().indexOf('isInline'));
    const empty = 1n << BigInt(foreignHookIndex().indexOf('canBeEmpty'));
    expect(
      registry
        .rows()
        .map(({ type, kind, ancestry, extends: parent, overrides }) => ({
          type,
          kind,
          ancestry,
          parent,
          overrides,
        }))
    ).toEqual([
      {
        type: 'p3',
        kind: 'Element',
        ancestry: ['p2', 'paragraph', 'element'],
        parent: 'p2',
        overrides: inline | empty,
      },
      {
        type: 'element',
        kind: 'Element',
        ancestry: [],
        parent: null,
        overrides: 0n,
      },
      {
        type: 'p2',
        kind: 'Element',
        ancestry: ['paragraph', 'element'],
        parent: 'paragraph',
        overrides: inline,
      },
      {
        type: 'paragraph',
        kind: 'Element',
        ancestry: ['element'],
        parent: 'element',
        overrides: 0n,
      },
    ]);
    expect(registry.rows()[0].native).toBe(Paragraph);
    registry.dispose();
  });

  it('uses separate constructor and instance slots for static import/transform hooks', () => {
    class Text {
      static getType() {
        return 'text';
      }
      static importJSON() {
        return 'native';
      }
    }
    class Custom extends Text {
      static getType() {
        return 'custom';
      }
      static importJSON() {
        return 'foreign';
      }
      static transform() {
        return 'transform';
      }
      importJSON() {
        return 'unrelated instance method';
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Text, kind: 'Text' }]),
      [Custom]
    );
    const names = foreignHookIndex();
    expect(registry.rows()[0].overrides).toBe(
      (1n << BigInt(names.indexOf('importJSON'))) |
        (1n << BigInt(names.indexOf('transform')))
    );
    expect(Custom.importJSON()).toBe('foreign');
    expect(new Custom().importJSON()).toBe('unrelated instance method');
    registry.dispose();
  });

  it('honors a spy installed after registration and before the first update', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
      [Custom]
    );
    const spy = vi.spyOn(Custom.prototype, 'isInline').mockReturnValue(true);
    expect(new Custom().isInline()).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    expect(registry.beforeUpdate()[0].overrides).toBe(
      1n << BigInt(foreignHookIndex().indexOf('isInline'))
    );
    spy.mockRestore();
    expect(registry.rows()[0].overrides).toBe(0n);
    registry.dispose();
  });

  it('rolls back an assignment that flips native behavior after the first update', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
      [Custom]
    );
    registry.beforeUpdate();
    const inherited = Custom.prototype.isInline;
    expect(() => {
      Custom.prototype.isInline = () => true;
    }).toThrow(
      'cannot override native hook isInline on custom after the first update'
    );
    expect(Custom.prototype.isInline).toBe(inherited);
    expect(new Custom().isInline()).toBe(false);
    expect(registry.rows()[0].overrides).toBe(0n);
    registry.dispose();
  });

  it('detects defineProperty patches before entering a later update', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
      [Custom]
    );
    registry.beforeUpdate();
    Object.defineProperty(Custom.prototype, 'isInline', {
      value: () => true,
      configurable: true,
      writable: true,
    });
    expect(() => registry.beforeUpdate()).toThrow('native hook isInline');
    // The registry does not undo an explicit external descriptor replacement.
    Object.defineProperty(Custom.prototype, 'isInline', {
      value: Element.prototype.isInline,
      configurable: true,
      writable: true,
    });
    expect(registry.beforeUpdate()[0].overrides).toBe(0n);
    expect(() => {
      Custom.prototype.isInline = () => true;
    }).toThrow('native hook isInline');
    registry.dispose();
  });

  it('compares patched native prototypes with the original catalog implementation', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const catalog = new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
    ]);
    const first = new ForeignClassRegistry(catalog, [Custom]);
    Element.prototype.isInline = () => true;
    const second = new ForeignClassRegistry(catalog, [Element, Custom]);
    const bit = 1n << BigInt(foreignHookIndex().indexOf('isInline'));
    expect(first.beforeUpdate()[0].overrides).toBe(bit);
    expect(second.beforeUpdate().map((row) => row.overrides)).toEqual([
      bit,
      bit,
    ]);
    first.dispose();
    second.dispose();
  });

  it('validates every editor sharing a prototype before accepting a patch', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const catalog = new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
    ]);
    const first = new ForeignClassRegistry(catalog, [Custom]);
    const second = new ForeignClassRegistry(catalog, [Custom]);
    second.beforeUpdate();
    expect(() => {
      Element.prototype.isInline = () => true;
    }).toThrow('native hook isInline');
    expect(first.rows()[0].overrides).toBe(0n);
    expect(second.rows()[0].overrides).toBe(0n);
    second.dispose();
    Element.prototype.isInline = () => true;
    expect(first.beforeUpdate()[0].overrides).not.toBe(0n);
    first.dispose();
  });

  it('permits JS replacements but rejects native-to-JS reintroduction after reset', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
      isInline() {
        return true;
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
      [Custom]
    );
    const mask = registry.beforeUpdate()[0].overrides;
    Custom.prototype.isInline = () => false;
    expect(registry.rows()[0].overrides).toBe(mask);
    Custom.prototype.isInline = Element.prototype.isInline;
    expect(registry.rows()[0].overrides).toBe(0n);
    expect(() => {
      Custom.prototype.isInline = () => true;
    }).toThrow('native hook isInline');
    registry.dispose();
  });

  it('does not intercept non-hooks or write accessors onto node instances', () => {
    class Element {
      static getType() {
        return 'element';
      }
      isInline() {
        return false;
      }
      select() {
        return 'native select';
      }
    }
    class Custom extends Element {
      static getType() {
        return 'custom';
      }
    }
    const registry = new ForeignClassRegistry(
      new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
      [Custom]
    );
    registry.beforeUpdate();
    Custom.prototype.select = () => 'patched select';
    expect(registry.rows()[0].overrides).toBe(0n);
    const node = new Custom();
    expect(Object.keys(node)).toEqual([]);
    node.isInline = () => true;
    expect(node.isInline()).toBe(true);
    expect(new Custom().isInline()).toBe(false);
    expect(registry.rows()[0].overrides).toBe(0n);
    registry.dispose();
  });

  it('rejects ambiguous type names and classes without native ancestry', () => {
    class Element {
      static getType() {
        return 'element';
      }
    }
    class A extends Element {
      static getType() {
        return 'duplicate';
      }
    }
    class B extends Element {
      static getType() {
        return 'duplicate';
      }
    }
    class Other {
      static getType() {
        return 'other';
      }
    }
    const catalog = new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
    ]);
    expect(() => new ForeignClassRegistry(catalog, [A, B])).toThrow(
      'duplicate node type duplicate'
    );
    expect(() => new ForeignClassRegistry(catalog, [Other])).toThrow(
      'no native ancestor'
    );
  });
});

it('preserves non-writable methods on both the prototype and its descendants', () => {
  class Element {
    static getType() {
      return 'element';
    }
    isInline() {
      return false;
    }
  }
  Object.defineProperty(Element.prototype, 'isInline', { writable: false });
  class Custom extends Element {
    static getType() {
      return 'custom';
    }
  }
  const registry = new ForeignClassRegistry(
    new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
    [Custom]
  );
  expect(() => {
    Element.prototype.isInline = () => true;
  }).toThrow(TypeError);
  expect(() => {
    Custom.prototype.isInline = () => true;
  }).toThrow(TypeError);
  expect(() => {
    new Custom().isInline = () => true;
  }).toThrow(TypeError);
  expect(new Custom().isInline()).toBe(false);
  expect(registry.rows()[0].overrides).toBe(0n);
  registry.dispose();
});

it('observes sealed prototypes without trying to add hook slots', () => {
  class Element {
    static getType() {
      return 'element';
    }
    isInline() {
      return false;
    }
  }
  class Custom extends Element {
    static getType() {
      return 'custom';
    }
  }
  Object.seal(Element.prototype);
  Object.preventExtensions(Custom.prototype);
  const registry = new ForeignClassRegistry(
    new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]),
    [Custom]
  );
  expect(registry.beforeUpdate()[0].overrides).toBe(0n);
  Element.prototype.isInline = () => true;
  expect(() => registry.beforeUpdate()).toThrow('native hook isInline');
  registry.dispose();
});

it('reserves native type names even when defaults are omitted from the input', () => {
  class Element {
    static getType() {
      return 'element';
    }
  }
  class Custom extends Element {}
  const catalog = new NativeNodeCatalog([{ klass: Element, kind: 'Element' }]);
  expect(() => new ForeignClassRegistry(catalog, [Custom])).toThrow(
    'duplicate node type element'
  );
});

it('keeps text/element getTextContent and element setFormat out of the override mask', () => {
  class Element {
    static getType() {
      return 'element';
    }
    getTextContent() {
      return 'native element';
    }
    setFormat() {
      return this;
    }
  }
  class Text {
    static getType() {
      return 'text';
    }
    getTextContent() {
      return 'native text';
    }
    setFormat() {
      return this;
    }
  }
  class Decorator {
    static getType() {
      return 'decorator';
    }
    getTextContent() {
      return '';
    }
  }
  class Block extends Element {
    static getType() {
      return 'block';
    }
    getTextContent() {
      return 'custom block';
    }
    setFormat() {
      return this;
    }
    canHaveFormat() {
      return false;
    }
  }
  class Inline extends Text {
    static getType() {
      return 'inline';
    }
    getTextContent() {
      return 'custom inline';
    }
    setFormat() {
      return this;
    }
  }
  class Mention extends Decorator {
    static getType() {
      return 'mention';
    }
    getTextContent() {
      return 'mention';
    }
  }
  const registry = new ForeignClassRegistry(
    new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
      { klass: Text, kind: 'Text' },
      { klass: Decorator, kind: 'Decorator' },
    ]),
    [Block, Inline, Mention]
  );
  const names = foreignHookIndex();
  expect(registry.beforeUpdate().map((row) => row.overrides)).toEqual([
    0n,
    1n << BigInt(names.indexOf('setFormat')),
    1n << BigInt(names.indexOf('getTextContent')),
  ]);
  registry.dispose();
});

it('includes implicit native ancestors and snapshots class type names once', () => {
  class Element {
    static getType() {
      return 'element';
    }
  }
  class Paragraph extends Element {
    static getType() {
      return 'paragraph';
    }
  }
  let calls = 0;
  class Custom extends Paragraph {
    static getType() {
      calls++;
      return 'custom';
    }
  }
  const registry = new ForeignClassRegistry(
    new NativeNodeCatalog([
      { klass: Element, kind: 'Element' },
      { klass: Paragraph, kind: 'Element' },
    ]),
    [Custom, Custom]
  );
  expect(registry.rows()[0].ancestry).toEqual(['paragraph', 'element']);
  expect(registry.beforeUpdate()[0].type).toBe('custom');
  expect(calls).toBe(1);
  registry.dispose();
});

it('recognizes abstract shim bases without calling their throwing getType', () => {
  class Element {
    static getType(): string {
      throw new Error('abstract getType');
    }
    isInline() {
      return false;
    }
  }
  class Custom extends Element {
    static getType() {
      return 'abstract-child';
    }
  }
  const catalog = new NativeNodeCatalog([
    { klass: Element, kind: 'Element', type: null },
  ]);
  const registry = new ForeignClassRegistry(catalog, [Custom]);
  const row = registry.beforeUpdate()[0];
  expect(row.type).toBe('abstract-child');
  expect(row.kind).toBe('Element');
  expect(row.extends).toBeNull();
  expect(row.ancestry).toEqual([]);
  expect(row.native).toBe(Element);
  expect(row.overrides).toBe(0n);
  expect(() => new ForeignClassRegistry(catalog, [Element])).toThrow(
    'abstract native bases cannot be registered'
  );
  registry.dispose();
});
