/** @vitest-environment jsdom */

import {
  ConnectAppNode,
  GroupMentionNode,
  ThemeMentionNode,
  UnknownMentionNode,
} from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import type { Klass, LexicalNode } from 'lexical';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { GroupMentionUIProps } from '../component/decorator/GroupMention';
import type { ThemeMentionUIProps } from '../component/decorator/ThemeMention';
import type { UnknownMentionUIProps } from '../component/decorator/UnknownMention';
import { theme } from '../theme';
import { createNativeFastSelectionDecoratorViews } from './fast-selection-views';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

const SELECTION_ROWS: readonly Klass<LexicalNode>[] = [
  GroupMentionNode,
  UnknownMentionNode,
  ThemeMentionNode,
  ConnectAppNode,
];

/**
 * Mounts stored nodes of one type beside a sibling paragraph through the real
 * registry, with a recording component for that type: this guards the
 * projector and registry mount, not the component's own rendering.
 */
function mount<Props extends {}>(
  type: string,
  klass: Klass<LexicalNode>,
  nodes: readonly object[]
) {
  const received: Props[] = [];
  // The selection views bind all four rows; the others are not mounted here.
  for (const row of SELECTION_ROWS)
    if (row !== klass) setDecorator(row, () => null);
  setDecorator<Props>(klass, (props) => {
    received.push(props);
    return <span data-recorded-decorator="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeSelectionDecoratorContext(theme);
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeFastSelectionDecoratorViews(context)
  );
  const close = () => {
    context.dispose();
    fixture.close();
  };
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: nodes.map((node) => ({ type, version: 1, ...node })),
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
  } catch (error) {
    // An expected refusal must not leak the constructed session and root.
    close();
    throw error;
  }
  return { fixture, received, close };
}

test('projector hands a stored null or missing group alias to the registered component unchanged', () => {
  const mounted = mount<GroupMentionUIProps>(
    'group-mention',
    GroupMentionNode,
    [{ groupAlias: 'everyone' }, { groupAlias: null }, {}, { groupAlias: '' }]
  );
  try {
    expect(mounted.received.map(({ groupAlias }) => groupAlias)).toEqual([
      'everyone',
      null,
      undefined,
      '',
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-decorator]')
    ).toHaveLength(4);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('stored model refuses a wrong group alias type before any projection', () => {
  expect(() =>
    mount('group-mention', GroupMentionNode, [{ groupAlias: 5 }]).close()
  ).toThrow('JSON error: invalid type');
});

test('projector hands a stored null or missing unknown mention name to the registered component unchanged', () => {
  const mounted = mount<UnknownMentionUIProps>(
    'unknown-mention',
    UnknownMentionNode,
    [{ name: 'Someone' }, { name: null }, {}, { name: '' }]
  );
  try {
    expect(mounted.received.map(({ name }) => name)).toEqual([
      'Someone',
      null,
      undefined,
      '',
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-decorator]')
    ).toHaveLength(4);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('stored model refuses a wrong unknown mention name type before any projection', () => {
  expect(() =>
    mount('unknown-mention', UnknownMentionNode, [{ name: 5 }]).close()
  ).toThrow('JSON error: invalid type');
});

test('projector hands a stored null or missing theme data to the registered component unchanged', () => {
  const data = { id: 'probe-theme', name: 'Probe theme', version: 3 };
  const mounted = mount<ThemeMentionUIProps>(
    'theme-mention',
    ThemeMentionNode,
    [
      { name: 'With data', data },
      { name: 'Null data', data: null },
      { name: 'Missing data' },
    ]
  );
  try {
    expect(mounted.received.map(({ name, data }) => ({ name, data }))).toEqual([
      { name: 'With data', data },
      { name: 'Null data', data: null },
      { name: 'Missing data', data: undefined },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-decorator]')
    ).toHaveLength(3);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('projector keeps its existing refusal of a null theme name and the stored model refuses non-map data', () => {
  // Retained strict boundary: no Source control yet shows how a null name behaves.
  expect(() =>
    mount('theme-mention', ThemeMentionNode, [
      { name: null, data: { id: 'probe-theme' } },
    ]).close()
  ).toThrow('Invalid theme mention payload');
  expect(() =>
    mount('theme-mention', ThemeMentionNode, [
      { name: 'Text data', data: 'not a theme' },
    ]).close()
  ).toThrow('JSON error: invalid type');
});
