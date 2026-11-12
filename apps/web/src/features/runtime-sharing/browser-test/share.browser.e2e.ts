import { expect, type Locator, type Page, test } from '@playwright/test';

const OWNER = 'macro|owner@example.com';
const ALICE = 'macro|alice@example.com';
const BOB = 'macro|bob@example.com';
const TEAM = '0198a4cc-e138-7670-a308-a6b7666027aa';
const MINE = '0198a4cc-e138-7670-a308-a6b766602701';
const ALICES = '0198a4cc-e138-7670-a308-a6b766602702';
const REQUEST = '0198a4cc-e138-7670-a308-a6b766602703';

const runtime = (id: string, name: string, owner: string, access: string) => ({
  allow_permission_bypass: false,
  id,
  kind: 'macrod',
  name,
  owner: { type: 'user', user_id: owner },
  access,
  shared_team_ids: [] as string[],
  created_by: owner,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  connected: true,
  last_connected_at: null,
});

/** A scripted storage service holding one owner's runtime and one teammate's. */
async function serve(page: Page) {
  const net = {
    mine: runtime(MINE, 'Mac mini', OWNER, 'owner'),
    theirs: runtime(ALICES, 'Build box', ALICE, 'none'),
    grants: [{ userId: ALICE, accessLevel: 'edit' }],
    residents: [
      {
        bot_id: 'bot-1',
        name: 'Resident Agent',
        owner_user_id: ALICE,
        team_id: null,
      },
    ],
    requests: [
      {
        id: REQUEST,
        requesterId: BOB,
        requestedLevel: 'edit',
        status: 'pending',
        revision: 1,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        requestedByAgent: 'bot-2',
      },
    ] as object[],
    mineRequest: null as object | null,
    writes: [] as { method: string; path: string; body: unknown }[],
  };
  await page.route(
    /\/(harnesses|entities\/harness)(\/|$)/,
    async (route, request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.ts') || url.pathname.endsWith('.tsx'))
        return route.continue();
      const headers = {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
      };
      const method = request.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const path = url.pathname;
      const reply = (json: unknown) => route.fulfill({ json, headers });
      if (method !== 'GET')
        net.writes.push({
          method,
          path,
          body: request.postData() ? request.postDataJSON() : undefined,
        });
      if (path.endsWith('/harnesses')) return reply([net.mine]);
      if (path.endsWith('/harnesses/directory'))
        return reply([net.mine, net.theirs]);
      if (path.endsWith('/residents')) return reply(net.residents);
      if (path.endsWith('/team-access')) {
        const { enabled, team_id } = request.postDataJSON();
        net.mine.shared_team_ids = enabled ? [team_id] : [];
        return route.fulfill({ status: 204, headers });
      }
      if (path.includes('/direct-access/')) {
        const user = decodeURIComponent(path.split('/').at(-1) ?? '');
        const level =
          method === 'DELETE' ? null : request.postDataJSON()?.accessLevel;
        net.grants = net.grants.filter((grant) => grant.userId !== user);
        if (level) net.grants.push({ userId: user, accessLevel: level });
        return route.fulfill({ status: 204, headers });
      }
      if (path.endsWith('/direct-access')) return reply(net.grants);
      if (path.endsWith('/resolve')) {
        net.requests = [];
        net.grants.push({ userId: BOB, accessLevel: 'edit' });
        return reply({ id: REQUEST, status: 'granted', revision: 2 });
      }
      if (path.endsWith('/access-requests/mine')) {
        net.mineRequest = {
          id: 'a',
          requesterId: OWNER,
          requestedLevel: 'edit',
          status: 'pending',
          revision: 1,
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-01T00:00:00Z',
        };
        return reply(net.mineRequest);
      }
      if (path.endsWith('/access-requests')) {
        const owned = path.includes(MINE);
        return reply({
          owner: owned ? OWNER : null,
          canReview: owned,
          accessLevel: owned ? 'owner' : null,
          supportedLevels: ['edit'],
          mine: owned ? null : net.mineRequest,
          requests: owned ? net.requests : [],
          pendingCount: owned ? net.requests.length : 0,
          nextOffset: null,
        });
      }
      return route.fulfill({ status: 404, headers });
    }
  );
  return net;
}

/** A real tap on phones, where a mouse click would land outside the top sheet. */
async function press(page: Page, target: Locator) {
  if (!test.info().project.use.hasTouch) return target.click();
  await expect(target).toBeInViewport({ ratio: 1 });
  const box = await target.boundingBox();
  if (!box) throw new Error('The press target is not rendered');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Corvu starts the opening slide a frame after mount, so wait for it to end. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
}

async function openMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Share menu' }).click();
  await expect(page.getByText('Share Mac mini')).toBeVisible();
}

test('adds a teammate as a user', async ({ page }) => {
  const net = await serve(page);
  await openMenu(page);
  await expect(
    page.locator('[data-runtime-grant]', { hasText: 'alice@example.com' })
  ).toBeVisible();

  const addable = page.locator('[data-runtime-teammate]');
  await expect(addable).toHaveCount(1);
  await addable.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('[data-runtime-grant]')).toHaveCount(2);
  expect(net.writes.at(-1)?.body).toMatchObject({ accessLevel: 'edit' });
  await page.screenshot({
    path: test.info().outputPath('share-menu.png'),
    fullPage: true,
  });
});

test('warns before removing access a resident depends on', async ({ page }) => {
  const net = await serve(page);
  await openMenu(page);
  await expect(page.locator('[data-runtime-resident]')).toContainText(
    'Resident Agent'
  );

  const grant = page.locator('[data-runtime-grant]', {
    hasText: 'alice@example.com',
  });
  await grant.getByRole('button', { name: 'Remove' }).click();
  const warning = page.getByRole('dialog', {
    name: 'Shut down Resident Agent?',
  });
  await settled(warning);
  await page.screenshot({
    path: test.info().outputPath('shutdown-warning.png'),
  });
  expect(net.writes).toEqual([]);

  // Backing out leaves the Share menu open and nothing changed.
  await press(page, warning.getByRole('button', { name: 'Cancel' }));
  await expect(warning).toHaveCount(0);
  await expect(page.getByText('Share Mac mini')).toBeVisible();
  expect(net.writes).toEqual([]);

  await grant.getByRole('button', { name: 'Remove' }).click();
  await settled(warning);
  await press(page, warning.getByRole('button', { name: 'Shut down' }));
  await expect(grant).toBeHidden();
  expect(net.writes.at(-1)?.path).toContain(encodeURIComponent(ALICE));
});

test('warns before making a resident owner a reader', async ({ page }) => {
  const net = await serve(page);
  await openMenu(page);
  const grant = page.locator('[data-runtime-grant]', {
    hasText: 'alice@example.com',
  });
  await expect(grant.getByRole('button', { name: 'Role' })).toHaveText('User');

  await grant.getByRole('button', { name: 'Role' }).click();
  await page.getByRole('menuitem', { name: 'Read' }).click();
  const warning = page.getByRole('dialog', {
    name: 'Shut down Resident Agent?',
  });
  await settled(warning);
  expect(net.writes).toEqual([]);

  await press(page, warning.getByRole('button', { name: 'Shut down' }));
  await expect(grant.getByRole('button', { name: 'Role' })).toHaveText('Read');
  expect(net.writes.at(-1)?.body).toMatchObject({ accessLevel: 'view' });
});

test('opens the runtime to the team with the switch', async ({ page }) => {
  const net = await serve(page);
  await openMenu(page);
  await expect(
    page.getByText('Only you and the people below have access.')
  ).toBeVisible();

  await page
    .getByRole('switch', { name: 'Team machine' })
    .dispatchEvent('click');

  await expect(
    page.getByText('Everyone on Sample team is a user of this machine.')
  ).toBeVisible();
  expect(net.writes.at(-1)?.body).toEqual({ team_id: TEAM, enabled: true });
});

test('approves a request an agent made, and says an agent asked', async ({
  page,
}) => {
  const net = await serve(page);
  await openMenu(page);
  const row = page.locator('[data-runtime-request]');
  await expect(row).toContainText('bob@example.com');
  await expect(row).toContainText('Asked by an agent on their behalf');

  await row.getByRole('button', { name: 'Approve' }).click();

  await expect(row).toBeHidden();
  await expect(
    page.locator('[data-runtime-grant]', { hasText: 'bob@example.com' })
  ).toBeVisible();
  expect(net.writes.at(-1)?.body).toMatchObject({ grantedLevel: 'edit' });
});

test('requests access from Teammates’ runtimes', async ({ page }) => {
  const net = await serve(page);
  await page.goto('/');
  const row = page.locator('[data-teammate-runtime="Build box"]');
  await expect(row).toContainText('Your access: None');

  await press(page, row.getByRole('button', { name: 'Request access' }));

  await expect(
    row.getByRole('button', { name: 'Cancel request' })
  ).toBeVisible();
  await expect(row).toContainText('Your access: Requested');
  expect(net.writes.at(-1)?.body).toMatchObject({ requestedLevel: 'edit' });
});

test('approves from Pending requests with one click, without remounting rows', async ({
  page,
}) => {
  const net = await serve(page);
  const reads: number[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname.endsWith(
        `/entities/harness/${MINE}/access-requests`
      )
    )
      reads.push(Date.now());
  });
  await page.goto('/');
  const row = page.locator('[data-pending-request="incoming"]');
  await expect(row).toContainText('bob@example.com');

  // Tag the row and record every time it is replaced.
  await page.evaluate(() => {
    const log: string[] = [];
    const ids = () =>
      [...document.querySelectorAll<HTMLElement>('[data-pending-request]')]
        .map((element) => {
          element.dataset.instId ||= String(log.length + Math.random());
          return element.dataset.instId;
        })
        .join(',');
    let last = ids();
    new MutationObserver(() => {
      const next = ids();
      if (next !== last) log.push(next);
      last = next;
    }).observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { remounts: log });
  });
  const settledReads = reads.length;
  // A settled section stays put: watch it for two seconds.
  await page.waitForTimeout(2000);
  expect(
    await page.evaluate(
      () => (window as unknown as { remounts: string[] }).remounts
    )
  ).toEqual([]);
  // No refetch loop: a settled section reads its machine only on refreshes.
  expect(reads.length - settledReads).toBeLessThanOrEqual(2);

  const clicked = Date.now();
  await press(page, row.getByRole('button', { name: 'Approve' }));
  await expect(row).toBeHidden();
  expect(Date.now() - clicked).toBeLessThan(1000);
  expect(
    net.writes.filter((write) => write.path.endsWith('/resolve'))
  ).toHaveLength(1);
});
