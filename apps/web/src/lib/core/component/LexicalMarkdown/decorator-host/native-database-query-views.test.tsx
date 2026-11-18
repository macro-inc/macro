/** @vitest-environment jsdom */

import {
  ConnectAppNode,
  GroupMentionNode,
  ThemeMentionNode,
  type UnknownMentionDecoratorProps,
  UnknownMentionNode,
} from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import {
  type DatabaseQueryDecoratorProps,
  DatabaseQueryNode,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { theme } from '../theme';
import { createNativeFastSelectionDecoratorViews } from './fast-selection-views';
import { createNativeDatabaseQueryContext } from './native-database-query-host';
import { createNativeDatabaseQueryViews } from './native-database-query-views';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored block answers, each followed by a sibling paragraph, with the
 * unknown-mention view Source falls back to; always closes the fixture.
 */
function withMounted(
  queries: readonly object[],
  check: (mounted: {
    root: HTMLElement;
    received: Omit<DatabaseQueryDecoratorProps, 'key' | 'theme'>[];
    fallbacks: string[];
  }) => void
) {
  const received: Omit<DatabaseQueryDecoratorProps, 'key' | 'theme'>[] = [];
  const fallbacks: string[] = [];
  setDecorator<DatabaseQueryDecoratorProps>(
    DatabaseQueryNode,
    ({ key: _key, theme: _theme, ...source }) => {
      received.push(source);
      return <span data-recorded-database-query="true" />;
    }
  );
  setDecorator<UnknownMentionDecoratorProps>(UnknownMentionNode, (props) => {
    fallbacks.push(props.name);
    return <span data-recorded-unknown="true" />;
  });
  // The shared selection views bind their siblings too; none is mounted here.
  for (const sibling of [GroupMentionNode, ThemeMentionNode, ConnectAppNode])
    setDecorator(sibling, () => <span />);
  const fixture = nativeSurface();
  const context = createNativeDatabaseQueryContext(theme, () => true);
  const selection = createNativeSelectionDecoratorContext(theme);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeDatabaseQueryViews(context)
    );
    registerMacroDecoratorViews(fixture.view.registry, {
      'unknown-mention':
        createNativeFastSelectionDecoratorViews(selection)['unknown-mention'],
    });
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: queries.flatMap((query) => [
            { type: 'database-query', version: 2, ...query },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ]),
        },
      })
    );
    check({ root: fixture.root, received, fallbacks });
  } finally {
    selection.dispose();
    context.dispose();
    fixture.close();
  }
}

/** Strip the host so only Source's component props are compared. */
const sourceProps = (
  received: Omit<DatabaseQueryDecoratorProps, 'key' | 'theme'>[]
) =>
  received.map((props) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'host'))
  );

const ANSWER = { queryId: 'q', prompt: 'How many?', displayMode: 'table' };

test('optional fields Source reads as absent when null or falsy reach the component absent', () => {
  withMounted(
    [
      ANSWER,
      { ...ANSWER, title: null, chart: null, height: null },
      { ...ANSWER, title: '', databaseId: '', tableId: '' },
      {
        ...ANSWER,
        displayMode: 'bar',
        chart: { x: 'a', y: ['b'], title: null, color: null, stack: null },
      },
      {
        ...ANSWER,
        displayMode: 'bar',
        databaseId: 'db',
        tableId: 't',
        title: 'Count',
        chart: { x: 'a', y: ['b'], title: 'Chart', stack: true },
        height: 240,
      },
    ],
    ({ received, fallbacks }) => {
      expect(fallbacks).toEqual([]);
      expect(sourceProps(received)).toEqual([
        ANSWER,
        ANSWER,
        ANSWER,
        { ...ANSWER, displayMode: 'bar', chart: { x: 'a', y: ['b'] } },
        {
          ...ANSWER,
          displayMode: 'bar',
          databaseId: 'db',
          tableId: 't',
          title: 'Count',
          chart: { x: 'a', y: ['b'], title: 'Chart', stack: true },
          height: 240,
        },
      ]);
    }
  );
});

test('answers Source cannot parse degrade to its unavailable fallback without failing the document', () => {
  const rejected = [
    { ...ANSWER, queryId: null },
    { prompt: 'How many?', displayMode: 'table' },
    { ...ANSWER, prompt: null },
    { queryId: 'q', displayMode: 'table' },
    { ...ANSWER, displayMode: null },
    { queryId: 'q', prompt: 'How many?' },
    { ...ANSWER, displayMode: 'unknown' },
    // Source accepts only a string or an omitted id, never null.
    { ...ANSWER, databaseId: null },
    { ...ANSWER, tableId: null },
    { ...ANSWER, title: 5 },
    { ...ANSWER, height: 5 },
    { ...ANSWER, chart: { x: '', y: [] } },
  ];
  withMounted(rejected, ({ root, received, fallbacks }) => {
    expect(received).toEqual([]);
    expect(fallbacks).toEqual(
      rejected.map(() => 'Unavailable database question')
    );
    expect(
      root.textContent?.split('sibling stays').length,
      'every sibling paragraph renders'
    ).toBe(rejected.length + 1);
  });
});

test('a null-heavy answer leaves the rest of the document rendering', () => {
  withMounted(
    [
      {
        ...ANSWER,
        title: null,
        databaseId: null,
        tableId: null,
        chart: null,
        height: null,
      },
    ],
    ({ root, fallbacks }) => {
      expect(fallbacks).toEqual(['Unavailable database question']);
      expect(root.textContent).toContain('sibling stays');
    }
  );
});
