import { expect, type Locator, type Page, test } from '@playwright/test';

// Alice and Bob edit one new 600 × 400 document side by side, each with the
// real shared-document session, engine, and editor, connected through the
// fixture's in-page sync server.

async function open(page: Page) {
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto('/?collab&people=alice,bob&size=600x400');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.psdFixture?.collab
            ?.people()
            .every((p) => p.engine() && p.peers().length > 0) ?? false
      )
    )
    .toBe(true);
}

const person = (page: Page, name: string) =>
  page.getByTestId(`psd-person-${name}`);

/** A drawn pixel at a fraction of a canvas, as RGB. */
function pixel(view: Locator, fx: number, fy: number) {
  return view
    .locator('canvas')
    .first()
    .evaluate(
      (node, [x, y]) => {
        const c = node as HTMLCanvasElement;
        const at = c
          .getContext('2d')
          ?.getImageData(
            Math.floor(c.width * x),
            Math.floor(c.height * y),
            1,
            1
          ).data;
        return at ? [at[0], at[1], at[2]] : [0, 0, 0];
      },
      [fx, fy]
    );
}

/** Layer names as one person's engine has them. */
function layerNames(page: Page, who: number) {
  return page.evaluate(async (index) => {
    const engine = window.psdFixture.collab?.people()[index]?.engine();
    return engine ? (await engine.layers()).map((l) => l.name) : [];
  }, who);
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

test('a brush stroke, a new layer, and undo reach the other person', async ({
  page,
}) => {
  await open(page);
  const alice = person(page, 'Alice').getByTestId('psd-canvas');
  const bob = person(page, 'Bob').getByTestId('psd-canvas');
  await expect.poll(() => pixel(bob, 0.5, 0.5)).toEqual(WHITE);

  // Alice paints across the middle of the document.
  const box = await alice.boundingBox();
  if (!box) throw new Error('no canvas');
  await alice.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('b');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, {
    steps: 16,
  });
  await page.mouse.up();
  await expect.poll(() => pixel(alice, 0.5, 0.5)).toEqual(BLACK);
  // Bob's canvas shows it, at the same place.
  await expect.poll(() => pixel(bob, 0.5, 0.5)).toEqual(BLACK);

  // Alice's pointer and avatar, on Bob's side.
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 3 });
  const cursor = person(page, 'Bob').getByTestId('psd-peer-cursor');
  await expect(cursor).toHaveAttribute('data-peer', 'Alice');
  await expect(
    person(page, 'Bob').getByTestId('psd-collaborator')
  ).toHaveAttribute('data-peer', 'Alice');

  // A layer Bob adds appears for Alice.
  await person(page, 'Bob').getByTestId('psd-new-layer').click();
  await expect.poll(() => layerNames(page, 0)).toContain('Layer 1');

  // Undo is Alice's own: her stroke goes, Bob's layer stays.
  await person(page, 'Alice').getByTestId('psd-tool-move').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => pixel(alice, 0.5, 0.5)).toEqual(WHITE);
  await expect.poll(() => pixel(bob, 0.5, 0.5)).toEqual(WHITE);
  expect(await layerNames(page, 1)).toContain('Layer 1');

  // One of them stores the merged file.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.psdFixture.collab?.people().map((p) => p.saves() > 0)
        ),
      { timeout: 30_000 }
    )
    .toEqual(expect.arrayContaining([true, false]));
});

test('someone opening later sees the edits made before', async ({ page }) => {
  await open(page);
  const alice = person(page, 'Alice').getByTestId('psd-canvas');
  const box = await alice.boundingBox();
  if (!box) throw new Error('no canvas');
  await alice.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('b');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, {
    steps: 16,
  });
  await page.mouse.up();
  await expect
    .poll(() => pixel(person(page, 'Bob').getByTestId('psd-canvas'), 0.5, 0.5))
    .toEqual(BLACK);

  // Bob closes the document and opens it again.
  await page.evaluate(() => window.psdFixture.collab?.reopen('Bob'));
  await expect
    .poll(() =>
      page.evaluate(
        () => window.psdFixture.collab?.people()[1]?.engine() !== undefined
      )
    )
    .toBe(true);
  await expect
    .poll(() => pixel(person(page, 'Bob').getByTestId('psd-canvas'), 0.5, 0.5))
    .toEqual(BLACK);
});
