import { expect, test } from '@playwright/test';
import type {} from './local-session-fixture';

test('local native surfaces initialize, edit independently, undo and close without sync or storage', async ({
  page,
}) => {
  const connections: string[] = [];
  const failures: string[] = [];
  page.on('websocket', (socket) => connections.push(socket.url()));
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/browser-test/local-session.html');
  await page.waitForFunction(() => Boolean(window.localSessions));
  const first = page.getByRole('textbox', { name: 'First composer' });
  const second = page.getByRole('textbox', { name: 'Second composer' });
  await first.fill('First draft');
  await second.fill('Second draft');
  await expect(first).toHaveText('First draft');
  await expect(second).toHaveText('Second draft');
  expect(await page.evaluate(() => window.localSessions.markdown())).toEqual([
    'First draft',
    'Second draft',
  ]);
  await page.evaluate(() => window.localSessions.undo());
  await expect(first).toHaveText('');
  await expect(second).toHaveText('Second draft');
  await page.evaluate(() => window.localSessions.redo());
  await expect(first).toHaveText('First draft');
  await expect(page.getByLabel('Preview')).toHaveText('Read-only content');
  await expect(page.getByLabel('Preview')).toHaveAttribute(
    'contenteditable',
    'false'
  );
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await page.evaluate(() => window.localSessions.close());
  expect(await page.evaluate(() => window.localSessions.errors)).toEqual([]);
  // Vite's development connection uses the fixture origin's root path.
  const fixtureUrl = new URL(page.url());
  expect(
    connections.filter((url) => {
      const socket = new URL(url);
      return socket.host !== fixtureUrl.host || socket.pathname !== '/';
    })
  ).toEqual([]);
  expect(failures).toEqual([]);
});
