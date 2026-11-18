import { expect, type Page, test } from '@playwright/test';

const FIXTURE = '/src/features/block-md/browser-test/wide-mode.html';
const DOCUMENT_ID = 'wide-mode-fixture';
const POSTED_AT = '2026-11-12T16:05:00.000Z';
const ROOT_ID = '00000000-0000-7000-8000-00000000d001';
const REPLY =
  'Yes. The import report lists every page by team, so each owner can say what moves first and what can wait until next quarter.';

function message(
  id: string,
  sender: string,
  content: string,
  threadId: null | string
) {
  return {
    id,
    parent: { type: 'document', id: DOCUMENT_ID },
    thread_id: threadId,
    kind: 'message',
    sender_id: `macro|${sender}@example.com`,
    mentions: [],
    content,
    created_at: POSTED_AT,
    updated_at: POSTED_AT,
    attachments: [],
    reactions: [],
  };
}

const ROOT = message(
  ROOT_ID,
  'ana',
  'Should we agree on the order with each team before the import starts?',
  null
);
const REPLIES = [
  message('00000000-0000-7000-8000-00000000d002', 'sam', REPLY, ROOT_ID),
];
const THREAD_STATE = {
  root_id: ROOT_ID,
  user_id: ROOT.sender_id,
  resolved: false,
  anchor: null,
  created_at: POSTED_AT,
  updated_at: POSTED_AT,
};

/**
 * Answers the document's Discussion with one unanchored thread and a reply.
 * Every other request outside the test's dev server gets a 404, so no hosted
 * or local service is read or written.
 */
async function answerDiscussion(page: Page, baseURL: string | undefined) {
  const devServer = new URL(FIXTURE, baseURL).origin;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const messages = `/messages/document/${DOCUMENT_ID}`;
    if (url.pathname.endsWith(`${messages}/timeline`)) {
      const root = {
        ...ROOT,
        state: THREAD_STATE,
        thread: {
          reply_count: REPLIES.length,
          latest_reply_at: POSTED_AT,
          preview: REPLIES,
        },
      };
      await route.fulfill({
        json: {
          entries: [{ type: 'message', message: root }],
          next_cursor: null,
          previous_cursor: null,
        },
      });
    } else if (url.pathname.endsWith(`${messages}/threads/${ROOT_ID}`)) {
      await route.fulfill({
        json: { root: ROOT, state: THREAD_STATE, replies: REPLIES },
      });
    } else if (
      url.origin === devServer &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({ status: 404, json: {} });
    }
  });
}

async function openDocument(page: Page, query = '') {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(FIXTURE + query);
  await expect(page.getByText('Roadmap')).toBeVisible({ timeout: 30_000 });
}

/**
 * Where the Discussion's header, comment, reply and composer sit across the
 * pane. The composer is measured by its frame, not its placeholder. On touch
 * the composer floats over the page instead, so it is left out.
 */
async function discussionColumns(page: Page, composer = true) {
  const discussion = page.locator('[data-entity-conversation]');
  const parts = [
    discussion.getByRole('button', { name: 'Discussion' }),
    discussion.getByText(ROOT.content),
    discussion.getByText(REPLY),
    ...(composer ? [discussion.locator('[data-input]')] : []),
  ];
  return Promise.all(
    parts.map(async (part) => {
      const box = await part.boundingBox();
      if (!box) throw new Error('The discussion is not rendered');
      return { left: Math.round(box.x), right: Math.round(box.x + box.width) };
    })
  );
}

async function columnWidth(page: Page): Promise<number> {
  const box = await page
    .getByRole('textbox', { name: 'Document content' })
    .boundingBox();
  if (!box) throw new Error('Document content is not rendered');
  return box.width;
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Wide mode is desktop and tablet only');

  test('wide mode fills the pane and survives a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openDocument(page);
    expect(await columnWidth(page)).toBe(768);

    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();
    // The pane less its 64px gutters, which keep room for the outline.
    await expect.poll(() => columnWidth(page)).toBe(1600 - 2 * 64);

    await page.reload();
    await expect(page.getByText('Roadmap')).toBeVisible({ timeout: 30_000 });
    expect(await columnWidth(page)).toBe(1600 - 2 * 64);

    await page.getByRole('button', { name: 'Turn off wide mode' }).click();
    await expect.poll(() => columnWidth(page)).toBe(768);
  });

  test('a pane narrower than the column looks the same either way', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 1000 });
    await openDocument(page);
    const standard = await columnWidth(page);

    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();
    expect(await columnWidth(page)).toBe(standard);
  });

  test('the column only widens as the pane widens', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openDocument(page);
    await page.getByRole('button', { name: 'Turn on wide mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Turn off wide mode' })
    ).toBeVisible();

    // Below the standard column plus 64px margins the text keeps the
    // standard width; past it the column takes the extra room.
    let previous = 0;
    for (const width of [780, 860, 890, 896, 900, 1000]) {
      await page.setViewportSize({ width, height: 1000 });
      const expected = Math.max(Math.min(768, width - 48), width - 128);
      await expect.poll(() => columnWidth(page)).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(previous);
      previous = expected;
    }
  });

  test('wide mode never narrows the text beside margin comments', async ({
    page,
  }) => {
    // 880px lays the comments out as a rail, 1000px and 1300px as a column
    // beside the text, and 1600px floats them beside the standard column.
    for (const width of [880, 1000, 1300, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await openDocument(page, '?comments');
      const standard = await columnWidth(page);
      // The seeded comment reached the layout: without it the text would be
      // the full standard column at these widths.
      if (width === 880 || width === 1000) expect(standard).toBeLessThan(768);

      await page.getByRole('button', { name: 'Turn on wide mode' }).click();
      await expect(
        page.getByRole('button', { name: 'Turn off wide mode' })
      ).toBeVisible();
      await expect
        .poll(() => columnWidth(page))
        .toBeGreaterThanOrEqual(standard);

      await page.getByRole('button', { name: 'Turn off wide mode' }).click();
      await expect.poll(() => columnWidth(page)).toBe(standard);
    }
  });
});

test.describe('discussion', () => {
  test.skip(({ isMobile }) => isMobile, 'Wide mode is desktop and tablet only');

  for (const width of [1000, 1600]) {
    test(`wide mode leaves the discussion where it was at ${width}px`, async ({
      page,
      baseURL,
    }) => {
      await answerDiscussion(page, baseURL);
      await page.setViewportSize({ width, height: 1000 });
      await openDocument(page, '?discussion');
      await expect(page.getByText(REPLY)).toBeVisible();
      const standard = await discussionColumns(page);
      // The composer spans the standard column, centered in the pane.
      const composer = standard[3];
      expect(composer.right - composer.left).toBe(768);
      expect(composer.left + composer.right).toBe(width);

      await page.getByRole('button', { name: 'Turn on wide mode' }).click();
      await expect.poll(() => columnWidth(page)).toBe(width - 2 * 64);
      expect(await discussionColumns(page)).toEqual(standard);

      await page.getByRole('button', { name: 'Turn off wide mode' }).click();
      await expect.poll(() => columnWidth(page)).toBe(768);
      expect(await discussionColumns(page)).toEqual(standard);
    });
  }

  test.describe('tablet', () => {
    test.use({ hasTouch: true, viewport: { width: 1194, height: 834 } });

    test('wide mode leaves the discussion where it was', async ({
      page,
      baseURL,
    }) => {
      await answerDiscussion(page, baseURL);
      await openDocument(page, '?discussion');
      await expect(page.locator('html')).toHaveAttribute(
        'data-touch-device',
        'true'
      );
      await expect(page.getByText(REPLY)).toBeVisible();
      const standard = await discussionColumns(page, false);
      // The header starts the standard column, centered in the pane.
      expect(standard[0].left).toBe((1194 - 768) / 2);

      await page.getByRole('button', { name: 'Turn on wide mode' }).tap();
      await expect.poll(() => columnWidth(page)).toBe(1194 - 2 * 64);
      expect(await discussionColumns(page, false)).toEqual(standard);
    });
  });
});

test('phones offer no wide mode', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone only');
  await openDocument(page);
  await expect(page.getByRole('button', { name: 'Ask Macro' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Turn on wide mode' })
  ).toHaveCount(0);
});
