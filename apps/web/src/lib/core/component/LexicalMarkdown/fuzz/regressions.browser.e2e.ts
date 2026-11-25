/**
 * Bugs the fuzzer found, as fixed scenarios. Each waits for the other
 * person's edit to reach the typist before checking, so they do not depend on
 * delivery timing.
 */

import { expect, type Page, type Route, test } from '@playwright/test';
import { END_MARKER, openPeers, type Peer } from './harness';
import { IMMEDIATE_DELIVERY, Relay } from './relay';

/** A 1×1 PNG, for the pictures a collaborator adds. */
const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Serves `PICTURE` for every picture URL, through the image proxy or not. */
async function servePictures(page: Page) {
  await page.route(
    (url) => url.href.includes('picture-'),
    (route: Route) =>
      route.fulfill({
        contentType: 'image/png',
        body: PICTURE,
        headers: {
          'access-control-allow-origin':
            route.request().headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
        },
      })
  );
}

/** How many pictures `peer` shows, loaded. */
const loadedPictures = (peer: Peer) =>
  peer.page
    .locator('img')
    .evaluateAll(
      (images) =>
        images.filter(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0
        ).length
    );

test('the caret after a line break stays there when someone else edits', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(
    browser,
    relay,
    'line-break-caret',
    2
  );
  const [alice, bob] = peers;

  await alice.page.keyboard.type('abc');
  await alice.page.keyboard.press('Shift+Enter');
  await bob.page.keyboard.type('x');
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain('Peer B:x');
  await alice.page.keyboard.type('xyz');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[0]))
    .toEqual({ type: 'p', text: 'Peer A:abc\nxyz' });
  await close();
});

test('the caret on a new line of a code block stays there when someone else edits', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(
    browser,
    relay,
    'code-line-caret',
    2
  );
  const [alice, bob] = peers;

  await alice.page.keyboard.press('Enter');
  await alice.page.keyboard.type('```');
  await alice.page.keyboard.press('Enter');
  await alice.page.keyboard.type('abc');
  await alice.page.keyboard.press('Enter');
  await bob.page.keyboard.type('x');
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain('Peer B:x');
  await alice.page.keyboard.type('xyz');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[1]))
    .toEqual({ type: 'code', text: 'abc\nxyz' });
  await close();
});

test('one undo takes back a word typed while someone else was typing', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(browser, relay, 'busy-undo', 2);
  const [alice, bob] = peers;

  const bobTyping = (async () => {
    for (let i = 0; i < 10; i++)
      await bob.page.keyboard.type('bob ', { delay: 15 });
  })();
  await alice.page.keyboard.type('hello world', { delay: 30 });
  await bobTyping;
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain(`Peer B:${'bob '.repeat(10)}`);
  await alice.page.keyboard.press('Control+z');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[0]))
    .toEqual({ type: 'p', text: 'Peer A:' });
  await close();
});

test('a collaborator adding and resizing pictures leaves focus in another editor', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(
    browser,
    relay,
    'pictures-keep-focus',
    2
  );
  const [alice, bob] = peers;
  await servePictures(alice.page);
  await servePictures(bob.page);

  // Alice leaves a caret in the document and moves to another split's composer.
  await alice.page.keyboard.type('abc');
  const composer = alice.page.getByRole('textbox', { name: 'Composer' });
  await composer.click();

  let typed = '';
  const typeInComposer = async (text: string) => {
    await alice.page.keyboard.type(text, { delay: 40 });
    typed += text;
  };
  for (let count = 1; count <= 2; count++) {
    await bob.api.evaluate(
      (api, [marker, url]) => api.insertImageBefore(marker, url),
      [END_MARKER, `https://example.com/picture-${count}.png`]
    );
    await expect.poll(() => loadedPictures(alice)).toBe(count);
    await typeInComposer('hey ');
  }
  // A resize remounts the picture on Alice's side.
  await bob.api.evaluate((api) => api.scaleImages(0.5));
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorJson()))
    .toContain('"scale":0.5');
  await expect.poll(() => loadedPictures(alice)).toBe(2);
  await typeInComposer('there');
  // Writes a mounted picture might make (its size, its scale) have landed.
  await alice.page.waitForTimeout(300);

  await expect(composer).toBeFocused();
  await expect(composer).toHaveText(typed);
  expect(await alice.api.evaluate((api) => api.blocks()[0])).toEqual({
    type: 'p',
    text: 'Peer A:abc',
  });
  // Back in the document, typing continues where Alice left it.
  await alice.api.evaluate((api) => api.placeAtEnd('Peer A:'));
  await alice.page.keyboard.type('d');
  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[0]))
    .toEqual({ type: 'p', text: 'Peer A:abcd' });
  await close();
});
