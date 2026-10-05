import { expect, type Locator, type Page, test } from '@playwright/test';

// Alice and Bob edit `showcase.fig` side by side, each with the real design
// session, engine, and viewer, connected through the fixture's in-page sync
// server (`memory-sync.ts`). Page "Screens" holds frames "Home" and
// "Settings"; page "Components" holds the "Button" component.

async function open(page: Page, people = 'alice,bob') {
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto(`/?collab&people=${people}&file=showcase.fig`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.figFixture?.collab
            ?.people()
            .every((p) => p.engine() && p.peers().length > 0) ?? false
      )
    )
    .toBe(true);
}

const person = (page: Page, name: string) =>
  page.getByTestId(`fig-person-${name}`);

/** Layers named `name` on the first page, as a person's engine has them. */
function layersNamed(page: Page, who: number, name: string) {
  return page.evaluate(
    async ([index, query]) => {
      const engine = window.figFixture.collab?.people()[index]?.engine();
      if (!engine) return -1;
      const hits = await engine.search(0, query, 50);
      return hits.filter((h) => h.name === query).length;
    },
    [who, name] as const
  );
}

/** A canvas pixel at a fraction of its size. */
function pixel(canvas: Locator, fx: number, fy: number) {
  return canvas
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

/** Draws a rectangle with the R tool between two canvas fractions. */
async function drawRectangle(
  page: Page,
  canvas: Locator,
  from: [number, number],
  to: [number, number]
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await canvas.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('r');
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1]
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 5,
  });
  await page.mouse.up();
}

test('edits, selections, and pointers reach the other person', async ({
  page,
}) => {
  await open(page);
  const alice = person(page, 'Alice').getByTestId('fig-canvas');
  const bob = person(page, 'Bob').getByTestId('fig-canvas');

  await drawRectangle(page, alice, [0.1, 0.72], [0.4, 0.8]);
  await expect.poll(() => layersNamed(page, 1, 'Rectangle 1')).toBe(1);
  // Bob's canvas shows it (the new rectangle's gray), at the same place.
  await expect.poll(() => pixel(bob, 0.25, 0.76)).toEqual([217, 217, 217]);

  // Alice's pointer and avatar, on Bob's side.
  const box = await alice.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 300, box.y + 120, { steps: 3 });
  const cursor = person(page, 'Bob').getByTestId('fig-peer-cursor');
  await expect(cursor).toHaveAttribute('data-peer', 'Alice');
  await expect(cursor).toBeVisible();
  await expect(
    person(page, 'Bob').getByTestId('fig-collaborator')
  ).toHaveAttribute('data-peer', 'Alice');

  // Undo is Alice's own, and Bob sees it.
  await alice.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => layersNamed(page, 1, 'Rectangle 1')).toBe(0);
  await expect.poll(() => pixel(bob, 0.25, 0.76)).not.toEqual([217, 217, 217]);

  // One of them stores the merged file.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.figFixture.collab?.people().map((p) => p.saves() > 0)
      )
    )
    .toEqual(expect.arrayContaining([true, false]));
});

test('both people’s layers appear on both sides, and following shows the other view', async ({
  page,
}) => {
  await open(page);
  const alice = person(page, 'Alice').getByTestId('fig-canvas');
  const bob = person(page, 'Bob').getByTestId('fig-canvas');
  await drawRectangle(page, alice, [0.1, 0.72], [0.3, 0.8]);
  await drawRectangle(page, bob, [0.5, 0.72], [0.8, 0.8]);
  // Each sees both rectangles (Bob's was named after Alice's arrived).
  for (const who of [0, 1])
    for (const name of ['Rectangle 1', 'Rectangle 2'])
      await expect.poll(() => layersNamed(page, who, name)).toBe(1);

  // Bob follows Alice: her page change takes Bob along.
  await person(page, 'Bob')
    .locator('[data-testid="fig-collaborator"][data-peer="Alice"]')
    .click();
  await expect(person(page, 'Bob').getByTestId('fig-following')).toBeVisible();
  await person(page, 'Alice')
    .getByTestId('fig-page')
    .filter({ hasText: 'Components' })
    .click();
  await expect(person(page, 'Bob').getByTestId('fig-layer-row')).toHaveText([
    'Button',
  ]);
  // Bob moving his own view stops following.
  await bob.click({ position: { x: 10, y: 10 } });
  await expect(person(page, 'Bob').getByTestId('fig-following')).toHaveCount(0);
});

test('a file stored outside the design starts it over, and the others reload', async ({
  page,
}) => {
  await open(page);
  const alice = person(page, 'Alice').getByTestId('fig-canvas');
  await drawRectangle(page, alice, [0.1, 0.72], [0.4, 0.8]);
  await expect.poll(() => layersNamed(page, 1, 'Rectangle 1')).toBe(1);
  // The merged file is stored, and reopening it keeps the rectangle once.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.figFixture.collab?.people().some((p) => p.saves() > 0)
      )
    )
    .toBe(true);
  await page.evaluate(() => window.figFixture.collab?.reopen('Bob'));
  await expect.poll(() => layersNamed(page, 1, 'Rectangle 1')).toBe(1);

  // A new upload replaces the stored file; whoever opens it next gets it
  // without the changes made on the old one.
  await page.evaluate(() => window.figFixture.collab?.storeOutside());
  await page.evaluate(() => window.figFixture.collab?.reopen('Bob'));
  await expect(person(page, 'Bob').getByTestId('fig-page')).toHaveText([
    'Page 1',
  ]);
  await expect.poll(() => layersNamed(page, 1, 'Rectangle 1')).toBe(0);
  // Alice's copy is out of date: read-only, with a way to reload.
  const notice = person(page, 'Alice').getByTestId('fig-session-notice');
  await expect(notice).toContainText('replaced');
  await expect(
    person(page, 'Alice').getByTestId('fig-tool-rectangle')
  ).toBeHidden();
  await notice.getByTestId('fig-session-action').click();
  await expect(person(page, 'Alice').getByTestId('fig-page')).toHaveText([
    'Page 1',
  ]);
  await expect(
    person(page, 'Alice').getByTestId('fig-tool-rectangle')
  ).toBeVisible();
  await expect.poll(() => layersNamed(page, 0, 'Rectangle 1')).toBe(0);
});

test('an unreachable sync service opens the design read-only, with retry', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.figFixture.collab?.setReachable(false);
    window.figFixture.collab?.reopen('Bob');
  });
  const bob = person(page, 'Bob');
  await expect(bob.getByTestId('fig-session-notice')).toContainText(
    'read-only'
  );
  await expect(bob.getByTestId('fig-layer-row').first()).toBeVisible();
  await expect(bob.getByTestId('fig-tool-rectangle')).toBeHidden();
  await page.evaluate(() => window.figFixture.collab?.setReachable(true));
  await bob.getByTestId('fig-session-action').click();
  await expect(bob.getByTestId('fig-tool-rectangle')).toBeVisible();
  await expect(bob.getByTestId('fig-session-notice')).toHaveCount(0);
});
