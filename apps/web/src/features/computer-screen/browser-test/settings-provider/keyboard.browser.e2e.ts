import { expect, type Page, test } from '@playwright/test';
import { match } from 'ts-pattern';

/** An RFB peer, not a keyboard mock: the real noVNC client sends its key packets. */
async function desktopPeer(page: Page) {
  let text = '';
  let keyEvents = 0;
  await page.routeWebSocket('wss://keyboard.invalid/**', (socket) => {
    let stage = 0;
    let pending = Buffer.alloc(0);
    let painted = false;
    const width = 320;
    const height = 200;
    socket.send(Buffer.from('RFB 003.008\n'));
    socket.onMessage((message) => {
      pending = Buffer.concat([pending, Buffer.from(message)]);
      while (pending.length) {
        if (stage === 0) {
          if (pending.length < 12) return;
          pending = pending.subarray(12);
          socket.send(Buffer.from([1, 1]));
          stage++;
        } else if (stage === 1) {
          pending = pending.subarray(1);
          socket.send(Buffer.alloc(4));
          stage++;
        } else if (stage === 2) {
          pending = pending.subarray(1);
          const init = Buffer.alloc(28);
          init.writeUInt16BE(width, 0);
          init.writeUInt16BE(height, 2);
          Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0]).copy(
            init,
            4
          );
          init.writeUInt32BE(4, 20);
          init.write('Test', 24);
          socket.send(init);
          stage++;
        } else {
          const type = pending[0];
          const length = match(type)
            .with(0, () => 20)
            .with(2, () =>
              pending.length < 4 ? undefined : 4 + pending.readUInt16BE(2) * 4
            )
            .with(3, () => 10)
            .with(4, () => 8)
            .with(5, () => 6)
            .with(6, () =>
              pending.length < 8 ? undefined : 8 + pending.readUInt32BE(4)
            )
            .otherwise(() => {
              throw new Error(`Unexpected RFB client message ${type}`);
            });
          if (length === undefined) return;
          if (pending.length < length) return;
          if (type === 4) {
            keyEvents++;
            const key = pending.readUInt32BE(4);
            if (pending[1] && key >= 32 && key <= 126)
              text += String.fromCharCode(key);
          }
          if (type === 3 && !painted) {
            const frame = Buffer.alloc(16 + width * height * 4);
            frame[3] = 1;
            frame.writeUInt16BE(width, 8);
            frame.writeUInt16BE(height, 10);
            socket.send(frame);
            painted = true;
          }
          pending = pending.subarray(length);
        }
      }
    });
  });
  return { text: () => text, keyEvents: () => keyEvents };
}

test('control focuses real noVNC and sends complete URLs past app capture shortcuts', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Phones stay watch-only');
  const guest = await desktopPeer(page);
  await page.goto('/keyboard.html');
  await expect(
    page.getByRole('region', { name: 'Computer screen' }).locator('canvas')
  ).toHaveJSProperty('width', 320);
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  const canvas = page
    .getByRole('region', { name: 'Computer screen' })
    .locator('canvas');
  await expect(canvas).toHaveJSProperty('width', 320);
  await expect(canvas).toBeFocused();
  await expect(canvas).toHaveAttribute('tabindex', '0');
  const url = 'https://example.test/path';
  await page.keyboard.type(url);
  await expect.poll(guest.text).toBe(url);
  await expect(page.getByLabel('App shortcuts')).toHaveText('0');

  // Focus can enter the remote input from the ordinary toolbar tab order.
  await page
    .getByRole('button', { name: 'Stop controlling', exact: true })
    .focus();
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();

  await page.getByRole('button', { name: 'Outside screen' }).click();
  await page.keyboard.press('h');
  await expect(page.getByLabel('App shortcuts')).toHaveText('1');
  await expect.poll(guest.text).toBe(url);
});

test('watch-only screens do not focus remote input or send keyboard packets', async ({
  page,
}) => {
  const guest = await desktopPeer(page);
  await page.goto('/keyboard.html?read');
  const canvas = page
    .getByRole('region', { name: 'Computer screen' })
    .locator('canvas');
  await expect(canvas).toHaveJSProperty('width', 320);
  await expect(
    page.getByRole('button', { name: 'Take control', exact: true })
  ).toHaveCount(0);
  await expect(canvas).toHaveAttribute('tabindex', '-1');
  await canvas.click();
  await expect(canvas).not.toBeFocused();
  await page.getByRole('button', { name: 'Outside screen' }).click();
  await page.keyboard.type('https://example.test');
  expect(guest.keyEvents()).toBe(0);
});
