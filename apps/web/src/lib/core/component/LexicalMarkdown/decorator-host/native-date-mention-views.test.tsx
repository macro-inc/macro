/** @vitest-environment jsdom */

import {
  formatRelativeDay,
  formatTooltipDate,
  parseMentionDate,
} from '@core/util/dateParser';
import { DateMentionNode } from '@macro-inc/lexical-core';
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
import type { DateMentionUIProps } from '../component/decorator/DateMention';
import { theme } from '../theme';
import { createNativeDateMentionContext } from './native-date-mention-host';
import { createNativeDateMentionViews } from './native-date-mention-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored date mentions (inline, in one paragraph) beside a sibling
 * paragraph, hands the result to `check`, and always closes the fixture.
 */
function withMounted(
  mentions: readonly object[],
  check: (mounted: {
    root: HTMLElement;
    received: DateMentionUIProps[];
  }) => void
) {
  const received: DateMentionUIProps[] = [];
  setDecorator<DateMentionUIProps>(DateMentionNode, (props) => {
    received.push(props);
    return <span data-recorded-date="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeDateMentionContext(theme);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeDateMentionViews(context)
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
                type: 'date-mention',
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

const fields = ({ date, displayFormat, mentionUuid }: DateMentionUIProps) => ({
  date,
  displayFormat,
  mentionUuid,
});

test('stored date fields Source keeps as null or missing reach the component unchanged', () => {
  withMounted(
    [
      { date: '2026-03-15', displayFormat: 'Mar 15, 2026', mentionUuid: 'm-1' },
      { date: null, displayFormat: 'Null Date' },
      { displayFormat: 'Missing Date' },
      { date: '2026-03-15', displayFormat: null, mentionUuid: null },
      { date: '2026-03-15' },
      { date: '', displayFormat: '', mentionUuid: '' },
    ],
    ({ received }) => {
      expect(received.map(fields)).toEqual([
        {
          date: '2026-03-15',
          displayFormat: 'Mar 15, 2026',
          mentionUuid: 'm-1',
        },
        { date: null, displayFormat: 'Null Date', mentionUuid: undefined },
        {
          date: undefined,
          displayFormat: 'Missing Date',
          mentionUuid: undefined,
        },
        { date: '2026-03-15', displayFormat: null, mentionUuid: null },
        {
          date: '2026-03-15',
          displayFormat: undefined,
          mentionUuid: undefined,
        },
        { date: '', displayFormat: '', mentionUuid: '' },
      ]);
    }
  );
});

test('a null-heavy date mention leaves the rest of the document rendering', () => {
  withMounted(
    [{ date: null, displayFormat: null, mentionUuid: null }],
    ({ root }) => {
      expect(root.querySelectorAll('[data-recorded-date="true"]')).toHaveLength(
        1
      );
      expect(root.textContent).toContain('sibling stays');
    }
  );
});

test('the DateMention parser and formatter helpers accept a null or missing date', () => {
  // DateMention reads only `date`, through these helpers: null reads as the
  // epoch (new Date(null)) and undefined as an invalid date, as before.
  expect(parseMentionDate(null).getTime()).toBe(0);
  expect(Number.isNaN(parseMentionDate(undefined).getTime())).toBe(true);
  expect(formatTooltipDate(parseMentionDate(undefined))).toBe('Invalid Date');
  expect(typeof formatRelativeDay(parseMentionDate(null))).toBe('string');
  expect(typeof formatRelativeDay(parseMentionDate(undefined))).toBe('string');
});

test('wrong value types are refused by the stored model before any projection', () => {
  for (const mention of [
    { date: 5, displayFormat: 'Five' },
    { date: '2026-03-15', displayFormat: 7 },
    { date: '2026-03-15', displayFormat: 'Uuid', mentionUuid: true },
  ]) {
    expect(() => withMounted([mention], () => {})).toThrow(
      'JSON error: invalid type'
    );
  }
});
