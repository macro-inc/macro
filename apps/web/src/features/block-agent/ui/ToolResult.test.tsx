/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { resultSummary, ToolResult } from './ToolResult';

afterEach(cleanup);

it('bounds large collections while keeping every record reachable', async () => {
  const view = render(() => (
    <ToolResult
      value={{
        bots: Array.from({ length: 75 }, (_, index) => ({
          name: `Bot ${index}`,
          handle: `bot-${index}`,
        })),
      }}
    />
  ));
  expect(view.getByTitle('Bot 19')).toBeTruthy();
  expect(view.queryByTitle('Bot 20')).toBeNull();
  await fireEvent.click(
    view.getByRole('button', { name: 'Show more · 55 remaining' })
  );
  expect(view.getByTitle('Bot 69')).toBeTruthy();
  await fireEvent.click(
    view.getByRole('button', { name: 'Show more · 5 remaining' })
  );
  expect(view.getByTitle('Bot 74')).toBeTruthy();
});

it('distinguishes empty, missing, scalar and structured responses', () => {
  expect(resultSummary({ items: [] })).toBe('0 items');
  expect(resultSummary({ inboxes: [{}] })).toBe('1 inbox');
  expect(resultSummary(null)).toBeUndefined();
  const view = render(() => (
    <ToolResult
      value={{
        count: 0,
        active: false,
        note: null,
        content: { text: 'Document contents' },
      }}
    />
  ));
  expect(view.getByText('0')).toBeTruthy();
  expect(view.getByText('false')).toBeTruthy();
  expect(view.getByText('Not set')).toBeTruthy();
  expect(view.getByText('Document contents')).toBeTruthy();
});

it('counts tags across scopes, rather than counting the groups', () => {
  expect(
    resultSummary({
      tagSets: [
        { tags: [{ label: 'Work' }] },
        { tags: [{ label: 'Personal' }, { label: 'Later' }] },
      ],
    })
  ).toBe('3 tags');
});

it('uses notification metadata for the result title', () => {
  const view = render(() => (
    <ToolResult
      value={{
        notifications: [
          {
            eventType: 'email_received',
            seen: false,
            metadata: { subject: 'Design review' },
          },
        ],
      }}
    />
  ));
  expect(view.getByTitle('Design review')).toBeTruthy();
});
