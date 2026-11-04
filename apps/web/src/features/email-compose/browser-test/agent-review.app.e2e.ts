import { expect, type Page, test } from '@playwright/test';

type Item = {
  id: string;
  status: string;
  error: null;
  result: null;
  draft: { subject: string; body: string; to: { email: string }[] };
};
type SavedReview = {
  id: string;
  sessionId: string;
  actingUser: string;
  executionId: string;
  title: string;
  revision: number;
  updatedAt: number;
  presentedAt: number | null;
  decision: null;
  kind: 'email';
  items: Item[];
};

const initial: SavedReview = {
  id: '019a0000-0000-7000-8000-000000000005',
  sessionId: '019a0000-0000-7000-8000-000000000001',
  actingUser: 'macro|owner@macro.local',
  executionId: 'execution',
  title: 'Drafts to review',
  revision: 1,
  updatedAt: 1,
  presentedAt: 1,
  decision: null,
  kind: 'email',
  items: [
    {
      id: 'first',
      status: 'pending',
      error: null,
      result: null,
      draft: {
        subject: 'First email',
        body: 'Hello',
        to: [{ email: 'first@example.com' }],
      },
    },
  ],
};

/**
 * Serves the review the card reads, polled or announced. `onSave` decides when
 * an edit's response is released; the edit is committed when it arrives.
 */
async function serveReview(
  page: Page,
  record: SavedReview,
  onSave: (committed: SavedReview) => Promise<void> = async () => {}
) {
  const server = { record };
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('macro:login', 'true'));
  await page.route('**/auth/user/legacy_user_permissions', (route) =>
    route.fulfill({
      json: {
        userId: 'macro|owner@macro.local',
        email: 'owner@macro.local',
        aiDataConsent: true,
        hasChromeExt: false,
        hasTrialed: false,
        isAgent: false,
        licenseStatus: 'active',
        permissions: [],
        referralCode: 'owner',
        tutorialComplete: true,
      },
    })
  );
  await page.route('**/agent-sessions/*/reviews/*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ json: server.record });
    }
    const decision = request.postDataJSON();
    server.record = {
      ...server.record,
      revision: server.record.revision + 1,
      items: server.record.items.map((item) =>
        decision.action === 'edit' && item.id === decision.item
          ? { ...item, draft: decision.draft.draft }
          : item
      ),
    };
    const committed = server.record;
    await onSave(committed);
    return route.fulfill({ json: committed });
  });
  return server;
}

test('a poll during an edit save keeps typing in the draft', async ({
  page,
}) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving!: () => void;
  const savingStarted = new Promise<void>((resolve) => {
    saving = resolve;
  });
  await serveReview(page, initial, async () => {
    saving();
    await released;
  });
  await page.goto('/src/features/email-compose/browser-test/agent-review.html');
  const body = page.locator('[contenteditable="true"]');
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' cool');
  await savingStarted;

  // The poll returns the revision the held save has already committed.
  await page.waitForResponse(
    async (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/reviews/') &&
      (await response.json()).revision === 2
  );
  await page.keyboard.type(' cats', { delay: 50 });
  await expect(body).toBeFocused();
  release();

  await expect(body).toHaveText('Hello cool cats');
  await expect(body).toBeFocused();
  await expect(page.getByTestId('created')).toHaveText('0');
  await expect(
    page.getByRole('button', { name: 'Reload saved review' })
  ).toHaveCount(0);
});

test('a status saved elsewhere replaces the open draft card', async ({
  page,
}) => {
  const server = await serveReview(page, initial);
  // The composer saves its normalized draft once it mounts.
  const mounted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/reviews/')
  );
  await page.goto('/src/features/email-compose/browser-test/agent-review.html');
  await mounted;

  server.record = {
    ...server.record,
    revision: server.record.revision + 1,
    items: server.record.items.map((item) => ({
      ...item,
      status: 'dismissed',
    })),
  };

  await expect(page.getByRole('status').getByText('Dismissed')).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
});

test('a draft edited elsewhere offers to reload the saved review', async ({
  page,
}) => {
  const server = await serveReview(page, initial);
  // The composer saves its normalized draft once it mounts.
  const mounted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/reviews/')
  );
  await page.goto('/src/features/email-compose/browser-test/agent-review.html');
  await mounted;

  server.record = {
    ...server.record,
    revision: server.record.revision + 1,
    items: server.record.items.map((item) => ({
      ...item,
      draft: { ...item.draft, body: 'Changed by a teammate' },
    })),
  };
  await expect(
    page.getByRole('button', { name: 'Reload saved review' })
  ).toBeVisible();
});

test('a review loaded before presentation becomes editable once presented', async ({
  page,
}) => {
  const server = await serveReview(page, {
    ...initial,
    revision: 0,
    presentedAt: null,
  });
  await page.goto('/src/features/email-compose/browser-test/agent-review.html');
  await expect(page.getByText('Preparing saved review…')).toBeVisible();

  server.record = { ...initial, revision: 1, presentedAt: 2 };
  await expect(page.getByText('Preparing saved review…')).toHaveCount(0);
  const body = page.locator('[contenteditable="true"]');
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' again');
  await expect(body).toHaveText('Hello again');
  await expect(page.getByTestId('created')).toHaveText('0');
});

test('an announced revision replaces the open card, and nothing else reads it', async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveReview(page, initial);
  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes('/reviews/'))
      reads.push(request.url());
  });
  // The composer saves its normalized draft once it mounts.
  const mounted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/reviews/')
  );
  await page.goto(
    '/src/features/email-compose/browser-test/agent-review.html?updates=announced'
  );
  await mounted;

  // The log announces the card's own save, then nothing for a while.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('review-updated', { detail: 2 }))
  );
  await page.clock.runFor(10_000);
  expect(reads).toHaveLength(1);

  server.record = {
    ...server.record,
    revision: 3,
    items: server.record.items.map((item) => ({
      ...item,
      status: 'dismissed',
    })),
  };
  const read = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/reviews/')
  );
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('review-updated', { detail: 3 }))
  );
  await read;

  await expect(page.getByRole('status').getByText('Dismissed')).toBeVisible();
  expect(reads).toHaveLength(2);
});
