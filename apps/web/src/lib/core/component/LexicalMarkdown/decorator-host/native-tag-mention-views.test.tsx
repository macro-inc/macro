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

test('stored tag fields Source keeps as null or missing reach the component unchanged', () => {
  withMounted(
    [
      {
        optionId: 'o-1',
        propertyDefinitionId: 'p-1',
        scope: 'team',
        name: 'Valid',
        color: '#f00',
      },
      {
        optionId: null,
        propertyDefinitionId: null,
        scope: null,
        name: null,
        color: null,
      },
      {},
      {
        optionId: '',
        propertyDefinitionId: '',
        scope: 'user',
        name: '',
        color: '',
      },
    ],
    ({ received }) => {
      expect(received.map(fields)).toEqual([
        {
          optionId: 'o-1',
          propertyDefinitionId: 'p-1',
          scope: 'team',
          name: 'Valid',
          color: '#f00',
        },
        {
          optionId: null,
          propertyDefinitionId: null,
          scope: null,
          name: null,
          color: null,
        },
        {
          optionId: undefined,
          propertyDefinitionId: undefined,
          scope: undefined,
          name: undefined,
          color: undefined,
        },
        {
          optionId: '',
          propertyDefinitionId: '',
          scope: 'user',
          name: '',
          color: '',
        },
      ]);
    }
  );
});

test('a null-heavy tag mention leaves the rest of the document rendering', () => {
  withMounted(
    [
      {
        optionId: null,
        propertyDefinitionId: null,
        scope: null,
        name: null,
        color: null,
      },
    ],
    ({ root }) => {
      expect(root.querySelectorAll('[data-recorded-tag="true"]')).toHaveLength(
        1
      );
      expect(root.textContent).toContain('sibling stays');
    }
  );
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
