import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { InitializeFromSnapshotRequest } from '../../../../../../services/sync-service/bebop/generated/schema';

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
let server: Miniflare;
let serverUrl: string;
function token(documentId: string, user: string) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      document_id: documentId,
      user_id: `macro|${user}@example.com`,
      access_level: 'edit',
      exp: Math.floor(Date.now() / 1000) + 600,
    })
  ).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', 'local').update(`${header}.${payload}`).digest('base64url')}`;
}
test.beforeAll(async () => {
  const syncPath = `${root}/services/sync-service`;
  server = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    scriptPath: `${syncPath}/build/worker/shim.mjs`,
    modules: true,
    modulesRoot: syncPath,
    modulesRules: [
      { type: 'ESModule', include: ['**/build/index.js'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true },
    ],
    compatibilityDate: '2025-03-05',
    durableObjects: {
      DOCUMENT_SYNC_SESSION: {
        className: 'DocumentSyncSession',
        useSQLite: true,
      },
    },
    d1Databases: { USER_PEER_MAPPING: 'collab-test' },
    r2Buckets: { DOCUMENT_SNAPSHOT_BUCKET: 'collab-test' },
    kvNamespaces: {
      DOCUMENT_VERSIONING_KV: 'versions',
      SNAPSHOT_STORE_KV: 'snapshots',
    },
    bindings: {
      DOCUMENT_PERMISSIONS_SECRET: 'local',
      INTERNAL_API_SECRET_KEY: 'INTERNAL_API_SECRET',
      INTERNAL_API_SECRET: 'local',
      SPS_API_SECRET_KEY: 'local',
      SPS_URL: 'http://discard.test',
      local: true,
    },
    outboundService: async () => new Response(null, { status: 204 }),
  });
  serverUrl = (await server.ready).toString();
  const db = await server.getD1Database('USER_PEER_MAPPING');
  for (const file of ['0001_add_users.sql', '0002_add_blame.sql']) {
    const sql = readFileSync(
      `${syncPath}/database/user-peer-mapping/migrations/${file}`,
      'utf8'
    );
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
});
test.afterAll(async () => {
  await server?.dispose();
});

test('live edits, named colored ranges, offline recovery and departing cursors', async ({
  browser,
}) => {
  const id = crypto.randomUUID();
  const seeded = await server.dispatchFetch(
    `${serverUrl}document/${id}/initialize`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token(id, 'alice')}` },
      body: new Uint8Array(
        InitializeFromSnapshotRequest.encode({
          snapshot: new Uint8Array(
            readFileSync(`${root}/static_assets/spreadsheet-golden.1.bin`)
          ),
        })
      ).buffer,
    }
  );
  expect(seeded.status).toBe(200);
  const contexts = await Promise.all(
    ['alice', 'bob', 'carol'].map(() => browser.newContext())
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await Promise.all(
      pages.map(async (page, index) => {
        const user = ['alice', 'bob', 'carol'][index];
        const socket = `${serverUrl.replace('http:', 'ws:')}document/${id}/connect?token=${token(id, user)}`;
        await page.goto(
          `http://localhost:3017/?${new URLSearchParams({ document: id, socket, user: `macro|${user}@example.com` })}`
        );
        await expect(page.locator('[data-address="A1"]')).toBeVisible();
      })
    );
    const [alice, bob, carol] = pages;
    await Promise.all(
      pages.map((page) =>
        expect
          .poll(() =>
            page.evaluate(() => window.spreadsheetFixture.connectionStatus())
          )
          .toBe('connected')
      )
    );
    await alice.locator('[data-address="A1"]').dblclick();
    await alice
      .getByRole('textbox', { name: 'Edit A1', exact: true })
      .fill('Shared budget');
    await alice.keyboard.press('Enter');
    await expect(bob.locator('[data-address="A1"]')).toHaveText(
      'Shared budget'
    );
    const edit = async (page: Page, address: string, value: string) => {
      await page.locator(`[data-address="${address}"]`).dblclick();
      await page
        .getByRole('textbox', { name: `Edit ${address}`, exact: true })
        .fill(value);
      await page.keyboard.press('Enter');
    };
    await Promise.all([edit(alice, 'B10', '10'), edit(bob, 'C10', '20')]);
    await expect(carol.locator('[data-address="B10"]')).toHaveText('10');
    await expect(carol.locator('[data-address="C10"]')).toHaveText('20');
    await Promise.all([
      edit(alice, 'A10', 'Alice value'),
      edit(bob, 'A10', 'Bob value'),
    ]);
    await expect
      .poll(async () => {
        const values = await Promise.all(
          pages.map((page) => page.locator('[data-address="A10"]').innerText())
        );
        return (
          new Set(values).size === 1 &&
          ['Alice value', 'Bob value'].includes(values[0])
        );
      })
      .toBe(true);
    await alice.locator('[data-address="B2"]').click();
    await expect(
      bob.locator('[data-remote-cursor][aria-label="alice: B2"]')
    ).toBeVisible();
    await carol.locator('[data-address="E6"]').click();
    await expect(
      bob.locator('[data-remote-cursor][aria-label="carol: E6"]')
    ).toBeVisible();
    const colors = await bob
      .locator('[data-remote-cursor]')
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).borderColor)
      );
    expect(new Set(colors).size).toBe(2);
    await alice.locator('[data-address="D4"]').click({ modifiers: ['Shift'] });
    await expect(
      bob.locator('[data-remote-cursor][aria-label="alice: D4"]')
    ).toBeVisible();
    const peer = await bob
      .locator('[data-remote-cursor][aria-label="alice: D4"]')
      .getAttribute('data-remote-cursor');
    const range = await bob
      .locator(`[data-remote-selection="${peer}"]`)
      .boundingBox();
    const start = await bob.locator('[data-address="B2"]').boundingBox();
    const end = await bob.locator('[data-address="D4"]').boundingBox();
    expect(range!.x).toBeCloseTo(start!.x, 0);
    expect(range!.width).toBeCloseTo(end!.x + end!.width - start!.x, 0);
    await bob.screenshot({ path: '/tmp/spreadsheet-live-collaboration.png' });
    // Longer than the awareness TTL: idle users must not vanish.
    await bob.waitForTimeout(12_000);
    await expect(bob.locator('[data-remote-cursor]')).toHaveCount(2);
    await bob.getByRole('button', { name: 'Add sheet', exact: true }).click();
    await expect(
      bob.getByRole('tab', { name: 'Sheet2', exact: true })
    ).toHaveAttribute('aria-selected', 'true');
    await expect(bob.locator('[data-remote-cursor]')).toHaveCount(0);
    await bob.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await expect(
      bob.locator('[data-remote-cursor][aria-label="alice: D4"]')
    ).toBeVisible();

    await contexts[0].setOffline(true);
    await alice.locator('[data-address="C8"]').dblclick();
    await alice
      .getByRole('textbox', { name: 'Edit C8', exact: true })
      .fill('Offline edit');
    await alice.keyboard.press('Enter');
    await contexts[0].setOffline(false);
    await expect(bob.locator('[data-address="C8"]')).toHaveText(
      'Offline edit',
      { timeout: 20000 }
    );
    await contexts[2].close();
    await expect(
      bob.locator('[data-remote-cursor-name]').filter({ hasText: 'carol' })
    ).toHaveCount(0, { timeout: 20000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
