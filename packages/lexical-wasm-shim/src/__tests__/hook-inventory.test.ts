import { expect, test } from 'vitest';
import { inventoryHooks } from '../../scripts/hook-inventory';
import { foreignHookIndex } from '../backend/conformance';
import { foreignHooks } from '../hooks.generated';

// Literal source examples distinguish actual base overrides from unrelated
// same-named methods; these are scanner inputs, not model substitutes.
const base = {
  path: 'packages/lexical/src/index.ts',
  text: `
    export class LexicalNode { static transform() { return null; } }
    export class ElementNode extends LexicalNode { getFormat() { return 0; } isInline() { return false; } }
    export class TextNode extends LexicalNode { selectionTransform() { return; } isSimpleText() { return true; } }
    export class DecoratorNode extends LexicalNode { isKeyboardSelectable() { return true; } }
    new TextNode().selectionTransform(); new DecoratorNode().isKeyboardSelectable(); LexicalNode.transform();
  `,
};

test('independent generated order matches the initialized model hook bits', () => {
  expect(foreignHookIndex()).toEqual(foreignHooks.map((hook) => hook.name));
  expect(
    foreignHooks.find((hook) => hook.name === 'canInsertAfter')
  ).toMatchObject({
    caller: null,
    override: 'packages/lexical-list/src/LexicalListItemNode.ts:516',
  });
});

test('nearest base and static membership exclude custom decorator methods and unrelated classes', () => {
  const inventory = inventoryHooks([
    base,
    {
      path: 'packages/example/src/nodes.ts',
      text: `
      import { ElementNode as Block, ElementNode, DecoratorNode } from 'lexical';
      class Link extends Block { isInline() { return true; } }
      class ChildLink extends Link { isInline() { return true; } }
      class DecoratorText extends DecoratorNode { getFormat() { return 3; } }
      class StaticOnly extends ElementNode { static getFormat() { return 4; } }
      class Unrelated { isInline() { return true; } }
      new ChildLink().isInline(); new DecoratorText().getFormat();
    `,
    },
  ]);
  expect(inventory.map((hook) => hook.name)).toEqual([
    'isInline',
    'isKeyboardSelectable',
    'selectionTransform',
    'transform',
  ]);
  expect(inventory[0].overrides).toHaveLength(2);
});

test('test-only overrides and non-hook overrides cannot create dispatch bits', () => {
  const inventory = inventoryHooks([
    base,
    {
      path: 'packages/example/src/__tests__/nodes.test.ts',
      text: "import { ElementNode } from 'lexical'; class Test extends ElementNode { getFormat() { return 3; } } new NewBlock().getFormat();",
    },
    {
      path: 'packages/example/src/nodes.ts',
      text: "import { TextNode } from 'lexical'; class Text extends TextNode { isSimpleText() { return false; } } node.isSimpleText();",
    },
  ]);
  expect(inventory.map((hook) => hook.name)).toEqual([
    'isKeyboardSelectable',
    'selectionTransform',
    'transform',
  ]);
});

test('new genuine virtual overrides are reported and require non-test callsites', () => {
  expect(() =>
    inventoryHooks([
      base,
      {
        path: 'packages/example/src/nodes.ts',
        text: "import { ElementNode } from 'lexical'; class NewBlock extends ElementNode { getFormat() { return 3; } }",
      },
    ])
  ).toThrow('hook has no upstream caller: getFormat');
  const inventory = inventoryHooks([
    base,
    {
      path: 'packages/example/src/nodes.ts',
      text: "import { ElementNode } from 'lexical'; class NewBlock extends ElementNode { getFormat() { return 3; } } new NewBlock().getFormat();",
    },
  ]);
  expect(inventory[0]).toMatchObject({ name: 'getFormat', static: false });
});

test('same-named node classes resolve through aliased package reexports', () => {
  const inventory = inventoryHooks([
    base,
    {
      path: 'packages/lexical-a/src/rule.ts',
      text: "import { ElementNode } from 'lexical'; export class Rule extends ElementNode { isInline() { return true; } }",
    },
    {
      path: 'packages/lexical-a/src/index.ts',
      text: "export { Rule } from './rule';",
    },
    {
      path: 'packages/lexical-b/src/rule.ts',
      text: "import { Rule as ParentRule } from '@lexical/a'; export class Rule extends ParentRule { isInline() { return false; } } new Rule().isInline();",
    },
  ]);
  expect(inventory.find((hook) => hook.name === 'isInline')?.overrides).toEqual(
    ['packages/lexical-a/src/rule.ts:1', 'packages/lexical-b/src/rule.ts:1']
  );
});

test('unrelated methods cannot stand in for node callers', () => {
  expect(() =>
    inventoryHooks([
      base,
      {
        path: 'packages/example/src/nodes.ts',
        text: `
      import { ElementNode } from 'lexical';
      class NewBlock extends ElementNode { getFormat() { return 3; } }
      class Form { getFormat() { return 4; } }
      new Form().getFormat();
    `,
      },
    ])
  ).toThrow('hook has no upstream caller: getFormat');
});

test('an instance call cannot satisfy a static extension point', () => {
  expect(() =>
    inventoryHooks([
      {
        ...base,
        text: base.text.replace(
          'LexicalNode.transform();',
          `
      class Other { transform() { return null; } }
      new Other().transform();
    `
        ),
      },
    ])
  ).toThrow('missing declared extension point or caller: transform');
});

test('selection text access cannot stand in for a node text hook caller', () => {
  expect(() =>
    inventoryHooks([
      {
        ...base,
        text: base.text.replace(
          'static transform()',
          'getTextContent() { return ""; } static transform()'
        ),
      },
      {
        path: 'packages/example/src/nodes.ts',
        text: `
      import { DecoratorNode } from 'lexical';
      class DecoratorText extends DecoratorNode { getTextContent() { return 'node'; } }
      class Selection { getTextContent() { return 'selection'; } }
      new Selection().getTextContent();
    `,
      },
    ])
  ).toThrow('hook has no upstream caller: getTextContent');
});
