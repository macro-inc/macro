/** @vitest-environment jsdom */

import { TagMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { TagMentionUIProps } from '../component/decorator/TagMention';
import { theme } from '../theme';
import { createNativeTagMentionContext } from './native-tag-mention-host';
import { createNativeTagMentionViews } from './native-tag-mention-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored tag mentions (inline, in one paragraph) beside a sibling
 * paragraph, hands the result to `check`, and always closes the fixture.
 */
function withMounted(
  mentions: readonly object[],
  check: (mounted: { root: HTMLElement; received: TagMentionUIProps[] }) => void
) {
  const received: TagMentionUIProps[] = [];
  setDecorator<TagMentionUIProps>(TagMentionNode, (props) => {
    received.push(props);
    return <span data-recorded-tag="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeTagMentionContext(theme);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeTagMentionViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: mentions.map((mention) => ({
                type: 'tag-mention',
                version: 1,
                ...mention,
              })),
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
    check({ root: fixture.root, received });
  } finally {
    context.dispose();
    fixture.close();
  }
}

const fields = ({
  optionId,
  propertyDefinitionId,
  scope,
  name,
  color,
}: TagMentionUIProps) => ({
  optionId,
  propertyDefinitionId,
  scope,
  name,
  color,
});

const VALID = {
  optionId: 'o-1',
  propertyDefinitionId: 'p-1',
  scope: 'team',
  name: 'Valid',
};

test('a stored null color reaches the component unchanged beside a rendering sibling', () => {
  withMounted(
    [
      { ...VALID, color: '#f00' },
      { ...VALID, color: null },
      { ...VALID, color: undefined },
    ],
    ({ root, received }) => {
      expect(received.map(fields)).toEqual([
        { ...VALID, color: '#f00' },
        { ...VALID, color: null },
        { ...VALID, color: undefined },
      ]);
      expect(root.textContent).toContain('sibling stays');
    }
  );
});

// Source throws in getTextContentSize for these, so the whole state fails there too.
test('a null or missing name is refused like Source', () => {
  for (const name of [null, undefined]) {
    expect(() => withMounted([{ ...VALID, name }], () => {})).toThrow(
      'Invalid tag mention payload'
    );
  }
});

// Known gap: Source opens these and navigates with null ids; the navigation
// target is typed text, owned outside the editor.
test('null or missing ids are refused', () => {
  for (const ids of [
    { optionId: null },
    { propertyDefinitionId: null },
    { optionId: undefined },
    { propertyDefinitionId: undefined },
  ]) {
    expect(() => withMounted([{ ...VALID, ...ids }], () => {})).toThrow(
      'Invalid tag mention payload'
    );
  }
});

test('wrong value types and unknown scopes are refused by the stored model before any projection', () => {
  for (const mention of [
    { optionId: 5, name: 'Five' },
    { optionId: 'o', propertyDefinitionId: 7 },
    { optionId: 'o', name: true },
    { optionId: 'o', color: 1 },
  ]) {
    expect(() => withMounted([mention], () => {})).toThrow(
      'JSON error: invalid type'
    );
  }
  expect(() =>
    withMounted([{ optionId: 'o', scope: 'org' }], () => {})
  ).toThrow('JSON error: unknown variant');
});
