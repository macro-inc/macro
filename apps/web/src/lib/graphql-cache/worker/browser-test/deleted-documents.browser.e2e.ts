import { expect, test } from '@playwright/test';

const TRASHED = 'GraphqlSoupDocument:00000000-0000-7000-8000-000000000001';
const LIVE = 'GraphqlSoupDocument:00000000-0000-7000-8000-000000000002';

test('a document trashed while the client was away leaves local search once checked', async ({
  page,
}) => {
  await page.goto('deleted-documents.html');
  const result = page.locator('#result');
  await expect(result).not.toHaveAttribute('data-status', 'running', {
    timeout: 60_000,
  });
  const text = (await result.textContent()) ?? '';
  expect(await result.getAttribute('data-status'), text).toBe('passed');
  const data = JSON.parse(text);
  // The stale record still matches by its old name: the reported bug.
  expect(data.beforeCheck, text).toEqual([TRASHED, LIVE]);
  expect(data.check).toEqual({
    removed: ['00000000-0000-7000-8000-000000000001'],
    outcome: 'removed',
  });
  expect(data.afterCheck).toEqual([LIVE]);
});
