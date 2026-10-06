import { expect, type Page, test } from '@playwright/test';
import { canvasOf, dragOn, engineRows, fitted, MOD, pixelAt } from './helpers';
import { SAMPLE_COLORS } from './sample-document';

// Alice and Bob edit the sample (`sample-document.ts`) side by side, each
// with the real shared-document session, engine, and editor, connected
// through the fixture's in-page sync server. The red rectangle spans
// (100,100)–(300,250); the text "Hello" sits around (100–215, 410–450).
const RED_BOX = { x: 200, y: 175 };
const MOVED_BOX = { x: 280, y: 425 };

async function open(page: Page, people = 'alice,bob') {
  await page.setViewportSize({ width: 2400, height: 900 });
  await page.goto(`/?collab&sample&people=${people}`);
  const count = people.split(',').length;
  await expect
    .poll(() =>
      page.evaluate((n) => {
        const all = window.aiFixture?.collab?.people() ?? [];
        return (
          all.length === n &&
          all.every((p) => p.engine() && p.peers().length > 0)
        );
      }, count)
    )
    .toBe(true);
}

const person = (page: Page, name: string) =>
  page.getByTestId(`ai-person-${name}`);

test('edits, undo, pointers, and avatars reach the other person', async ({
  page,
}) => {
  await open(page);
  const alice = canvasOf(person(page, 'Alice'));
  const bob = canvasOf(person(page, 'Bob'));
  const aliceView = await fitted(alice);
  const bobView = await fitted(bob);
  await expect
    .poll(() => pixelAt(bob, bobView.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);

  // Each creates objects in an id session of their own.
  const sessions = await page.evaluate(() =>
    window.aiFixture.collab?.people().map((p) => p.session())
  );
  expect(new Set(sessions).size).toBe(2);
  expect(sessions?.every((s) => s !== undefined && s >= 1 && s <= 4095)).toBe(
    true
  );

  // Alice moves the rectangle; Bob sees it move.
  const red = aliceView.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect(person(page, 'Alice').getByTestId('ai-field-w')).toHaveValue(
    '200'
  );
  await dragOn(page, red, aliceView.at({ x: RED_BOX.x, y: RED_BOX.y + 250 }));
  await expect
    .poll(() => pixelAt(bob, bobView.at(MOVED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);
  await expect
    .poll(() => pixelAt(bob, bobView.at(RED_BOX)))
    .toEqual([255, 255, 255]);

  // Alice's pointer and avatar, on Bob's side.
  const box = await alice.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 3 });
  const cursor = person(page, 'Bob').getByTestId('ai-peer-cursor');
  await expect(cursor).toHaveAttribute('data-peer', 'Alice');
  await expect(cursor).toBeVisible();
  await expect(
    person(page, 'Bob').getByTestId('ai-collaborator')
  ).toHaveAttribute('data-peer', 'Alice');

  // Undo is Alice's own, and Bob sees it.
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(() => pixelAt(bob, bobView.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);

  // One of them stores the merged file.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.aiFixture.collab?.people().map((p) => p.saves() > 0)
      )
    )
    .toEqual(expect.arrayContaining([true, false]));
});

test('objects both people draw appear on both sides', async ({ page }) => {
  await open(page);
  const alice = canvasOf(person(page, 'Alice'));
  const bob = canvasOf(person(page, 'Bob'));
  const aliceView = await fitted(alice);
  const bobView = await fitted(bob);
  await alice.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('m');
  await dragOn(
    page,
    aliceView.at({ x: 450, y: 450 }),
    aliceView.at({ x: 550, y: 550 })
  );
  await bob.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await dragOn(
    page,
    bobView.at({ x: 650, y: 450 }),
    bobView.at({ x: 750, y: 550 })
  );
  for (const who of [0, 1])
    await expect
      .poll(async () =>
        (await engineRows(page, who)).filter((r) => r.kind === 'path')
      )
      .toHaveLength(4);
  // Same ids on both sides.
  const ids = await Promise.all(
    [0, 1].map(async (who) =>
      (await engineRows(page, who)).map((r) => r.id).sort((a, b) => a - b)
    )
  );
  expect(ids[0]).toEqual(ids[1]);
});

test('a file stored outside the document starts it over, and the others reload', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.aiFixture.collab?.storeOutside());
  await page.evaluate(() => window.aiFixture.collab?.reopen('Bob'));
  // Bob opened the new blank file.
  await expect(person(page, 'Bob').getByTestId('ai-layer-row')).toHaveText([
    'Layer 1',
  ]);
  // Alice's copy is out of date: read-only, with a way to reload.
  const notice = person(page, 'Alice').getByTestId('ai-session-notice');
  await expect(notice).toContainText('replaced');
  await expect(
    person(page, 'Alice').getByTestId('ai-tool-rectangle')
  ).toHaveCount(0);
  await notice.getByTestId('ai-session-action').click();
  await expect(person(page, 'Alice').getByTestId('ai-layer-row')).toHaveText([
    'Layer 1',
  ]);
  await expect(
    person(page, 'Alice').getByTestId('ai-tool-rectangle')
  ).toBeVisible();
});

test('an unreachable sync service opens the document read-only, with retry', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.aiFixture.collab?.setReachable(false);
    window.aiFixture.collab?.reopen('Bob');
  });
  const bob = person(page, 'Bob');
  await expect(bob.getByTestId('ai-session-notice')).toContainText('read-only');
  await expect(bob.getByTestId('ai-layer-row').first()).toBeVisible();
  await expect(bob.getByTestId('ai-tool-rectangle')).toHaveCount(0);
  await page.evaluate(() => window.aiFixture.collab?.setReachable(true));
  await bob.getByTestId('ai-session-action').click();
  await expect(bob.getByTestId('ai-tool-rectangle')).toBeVisible();
  await expect(bob.getByTestId('ai-session-notice')).toHaveCount(0);
});
