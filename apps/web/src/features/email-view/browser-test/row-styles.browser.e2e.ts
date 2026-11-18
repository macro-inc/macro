import { expect, type Locator, type Page, test } from '@playwright/test';

// Phones always show Minimalist rows, whatever the setting says.
const SIZES = [
  { name: 'wide', width: 1100, height: 700, touch: false, wide: true },
  { name: 'stacked', width: 440, height: 800, touch: false, wide: false },
  { name: 'tablet', width: 820, height: 1180, touch: true, wide: true },
  { name: 'phone', width: 390, height: 844, touch: true, wide: false },
];

async function open(page: Page, style: string, theme = 'dark', view = 'list') {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The dev server proxies this prefix to the hosted dev backend.
    if (
      url.hostname !== 'localhost' ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.abort();
      return;
    }
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto(
    `/src/features/email-view/browser-test/row-styles.html?style=${style}&theme=${theme}&view=${view}`
  );
  await expect(
    view === 'settings'
      ? page.locator('[data-email-row-style-preview]')
      : page.getByTestId('row-read-4')
  ).toBeVisible({ timeout: 180_000 });
}

const fontWeight = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).fontWeight);
const color = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).color);

/** Whether the row shows its checkbox outline without a hover. */
const showsCheckbox = (row: Locator) =>
  row.evaluate((node) => {
    const box = node.querySelector('[role="checkbox"] span');
    if (!box || box.getClientRects().length === 0) return false;
    return getComputedStyle(box).opacity === '1';
  });

/** The row's own surface: the entity root inside the test row. */
const rowSurface = (page: Page, id: string) =>
  page.getByTestId(`row-${id}`).locator('.soup-list-entity');

/** A Row style tab in Settings; its label takes the click for the radio. */
const rowStyleTab = (page: Page, name: string) =>
  page
    .getByRole('radiogroup', { name: 'Row style' })
    .getByText(name, { exact: true });

async function weights(
  page: Page,
  id: string,
  sender: string,
  subject: string
) {
  const row = page.getByTestId(`row-${id}`);
  const senderText = row.getByText(sender, { exact: true });
  const subjectText = row.getByText(subject, { exact: true });
  const dateText = row.getByText('Nov 3', { exact: true });
  return {
    sender: await fontWeight(senderText),
    subject: await fontWeight(subjectText),
    date: await fontWeight(dateText),
    preview: await fontWeight(row.getByText(/^Here is the latest/)),
    senderColor: await color(senderText),
    subjectColor: await color(subjectText),
    dateColor: await color(dateText),
  };
}

// A route still fetching as a test ends must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    // The `mobile:` variant: touch and under 640px.
    const phone = size.touch && size.width < 640;
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: phone,
    });

    const minimalistStyles = phone ? ['minimalist', 'classic'] : ['minimalist'];
    for (const style of minimalistStyles) {
      test(`${style} setting: unread mail has a dot, the checkbox is hidden`, async ({
        page,
      }) => {
        await open(page, style);
        const unread = page.getByTestId('row-unread-1');
        const read = page.getByTestId('row-read-1');

        await expect(unread.locator('.bg-accent.rounded-full')).toBeVisible();
        expect(await showsCheckbox(unread)).toBe(false);
        // No surface of its own: unread and read rows share the list's.
        await expect(rowSurface(page, 'unread-1')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        );
        await expect(read.locator('.bg-accent.rounded-full')).toHaveCSS(
          'opacity',
          '0'
        );
      });
    }

    for (const theme of ['dark', 'light']) {
      test(`Classic lifts unread rows and keeps the checkbox (${theme})`, async ({
        page,
      }) => {
        test.skip(phone);
        await open(page, 'classic', theme);
        const unread = page.getByTestId('row-unread-1');
        const read = page.getByTestId('row-read-1');

        // No unread dot; every row shows its checkbox outline instead.
        await expect(page.locator('.bg-accent.rounded-full')).toHaveCount(0);
        for (const row of [unread, read]) {
          expect(await showsCheckbox(row)).toBe(true);
        }

        // The unread row is lifted onto a surface; the read row is not.
        const unreadFill = await rowSurface(page, 'unread-1').evaluate(
          (node) => getComputedStyle(node).backgroundColor
        );
        expect(unreadFill).not.toBe('rgba(0, 0, 0, 0)');
        // Touch rows sit on an opaque swipe surface, which takes the fill.
        if (size.touch) {
          await expect(unread.locator('[data-swipe-content]')).toHaveCSS(
            'background-color',
            unreadFill
          );
          expect(
            await read
              .locator('[data-swipe-content]')
              .evaluate((node) => getComputedStyle(node).backgroundColor)
          ).not.toBe(unreadFill);
        }
        await expect(rowSurface(page, 'read-1')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        );
        // Lifting reserves no extra room: both rows are as tall.
        const height = async (id: string) =>
          (await rowSurface(page, id).boundingBox())?.height;
        expect(await height('unread-1')).toBe(await height('read-1'));

        // Sender, subject and date are bolder while unread; the preview isn't.
        const unreadWeights = await weights(
          page,
          'unread-1',
          'Avery Stone',
          'Contract redlines for Friday'
        );
        const readWeights = await weights(
          page,
          'read-1',
          'Casey Moore',
          'Notes from the offsite'
        );
        expect(unreadWeights.sender).toBe('600');
        expect(unreadWeights.subject).toBe('600');
        expect(unreadWeights.date).toBe('600');
        expect(readWeights.sender).toBe('400');
        expect(readWeights.subject).toBe('400');
        expect(readWeights.date).toBe('400');
        expect(unreadWeights.preview).toBe(readWeights.preview);
        // The unread date takes its sender's and subject's color; a read
        // date stays muted.
        expect(unreadWeights.subjectColor).toBe(unreadWeights.senderColor);
        expect(unreadWeights.dateColor).toBe(unreadWeights.senderColor);
        expect(readWeights.dateColor).not.toBe(readWeights.senderColor);

        // A selected row's fill wins over the unread one, on the swipe
        // surface too, where touch rows show it.
        await unread.getByRole('checkbox').click();
        const selectedSurface = size.touch
          ? unread.locator('[data-swipe-content]')
          : rowSurface(page, 'unread-1');
        const selectedFill = await selectedSurface.evaluate((node) => {
          const style = getComputedStyle(node);
          return `${style.backgroundColor} ${style.backgroundImage}`;
        });
        expect(selectedFill).not.toBe(`${unreadFill} none`);
      });
    }

    test('Classic rows share one faint line, read or unread', async ({
      page,
    }) => {
      test.skip(phone);
      await open(page, 'classic');
      // Two date groups; each opens with the first row of its own.
      const GROUPS = [
        ['unread-1', 'unread-2', 'read-1', 'unread-3'],
        ['read-2', 'read-3', 'unread-4', 'read-4'],
      ];
      const edges = async (id: string) =>
        rowSurface(page, id).evaluate((root) => {
          const style = getComputedStyle(root);
          const line = getComputedStyle(root, '::after');
          const box = root.getBoundingClientRect();
          // Lines the row paints itself, besides the one under it.
          const ownLines = [...root.querySelectorAll('*')]
            .filter((node) => {
              const own = getComputedStyle(node);
              return (
                own.visibility !== 'hidden' &&
                own.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                node.getBoundingClientRect().height <= 1
              );
            })
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return {
                top: rect.top,
                height: rect.height,
                width: rect.width,
                color: getComputedStyle(node).backgroundColor,
              };
            });
          return {
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            borders: `${style.borderTopWidth} ${style.borderBottomWidth}`,
            shadow: style.boxShadow,
            line: line.content === 'none' ? null : line.height,
            lineColor: line.backgroundColor,
            lineWidth: line.width,
            ownLines,
          };
        });
      /** Lines a date header paints: none, so no pair of lines doubles up. */
      const headerLines = (label: string) =>
        page.getByText(label, { exact: true }).evaluate((text) => {
          const header = text.closest('[role="row"]');
          if (!header) return -1;
          return [header, ...header.querySelectorAll('*')].filter((node) => {
            const own = getComputedStyle(node);
            const widths = [
              own.borderTopWidth,
              own.borderBottomWidth,
              own.borderLeftWidth,
              own.borderRightWidth,
            ];
            return (
              widths.some((width) => width !== '0px') ||
              own.boxShadow !== 'none' ||
              getComputedStyle(node, '::before').content !== 'none' ||
              getComputedStyle(node, '::after').content !== 'none'
            );
          }).length;
        });
      expect(await headerLines('Today')).toBe(0);
      expect(await headerLines('Yesterday')).toBe(0);

      const groups = [];
      for (const ids of GROUPS) {
        const rows = [];
        for (const id of ids) rows.push(await edges(id));
        groups.push(rows);
      }
      const lineColor = groups[0][0].lineColor;
      for (const rows of groups) {
        for (const [index, row] of rows.entries()) {
          // No border or shadow of its own: only the line under it.
          expect(row.borders).toBe('0px 0px');
          expect(row.shadow).toBe('none');
          expect(row.line).toBe('1px');
          expect(row.lineColor).toBe(lineColor);
          // Wall to wall.
          expect(row.lineWidth).toBe(`${row.width}px`);
          if (index === 0) {
            // The group's first row also has the same line on its top edge.
            expect(row.ownLines).toEqual([
              { top: row.top, height: 1, width: row.width, color: lineColor },
            ]);
          } else {
            // Later rows share the line of the row above them.
            expect(row.ownLines).toEqual([]);
            expect(row.top).toBe(rows[index - 1].bottom);
          }
        }
      }
      // A date header sits between one group's last line and the next
      // group's first, so they never touch.
      const lastOfFirst = groups[0][groups[0].length - 1];
      expect(groups[1][0].top).toBeGreaterThan(lastOfFirst.bottom);
    });

    for (const theme of ['dark', 'light']) {
      test(`Settings sample follows the Row style tabs (${theme})`, async ({
        page,
      }) => {
        // Phones hide Display options; they always show Minimalist.
        test.skip(phone);
        // Mail's own Classic colors, to compare the sample against.
        await open(page, 'classic', theme);
        const mailFill = await rowSurface(page, 'unread-1').evaluate(
          (node) => getComputedStyle(node).backgroundColor
        );
        const mailLine = await rowSurface(page, 'unread-1').evaluate(
          (node) => getComputedStyle(node, '::after').backgroundColor
        );

        await open(page, 'minimalist', theme, 'settings');
        const sample = page.locator('[data-email-row-style-preview]');
        const [unread, read] = await sample.locator('.soup-list-entity').all();
        // A picture of the list: nothing in it takes focus or clicks.
        expect(
          await sample.evaluate((node) => (node as HTMLElement).inert)
        ).toBe(true);
        // Screen readers skip it and get the styles described instead.
        await expect(
          page.getByText(/^Classic separates rows with lines/)
        ).toHaveClass(/sr-only/);
        await expect(unread.locator('.bg-accent.rounded-full')).toBeVisible();
        expect(await showsCheckbox(unread)).toBe(false);

        await rowStyleTab(page, 'Classic').click();
        await expect(sample).toHaveAttribute(
          'data-email-row-style-preview',
          'classic'
        );
        await expect(sample.locator('.bg-accent.rounded-full')).toHaveCount(0);
        expect(await showsCheckbox(unread)).toBe(true);
        expect(await showsCheckbox(read)).toBe(true);
        expect(
          await fontWeight(unread.getByText('Avery Stone', { exact: true }))
        ).toBe('600');
        expect(
          await fontWeight(read.getByText('Casey Moore', { exact: true }))
        ).toBe('400');
        // The sample draws Mail's own fill and line, not the card's.
        await expect(unread).toHaveCSS('background-color', mailFill);
        expect(
          await read.evaluate(
            (node) => getComputedStyle(node, '::after').backgroundColor
          )
        ).toBe(mailLine);

        await rowStyleTab(page, 'Minimalist').click();
        await expect(unread.locator('.bg-accent.rounded-full')).toBeVisible();
      });
    }

    test('Classic checkboxes select without opening; rows still open', async ({
      page,
    }) => {
      test.skip(phone);
      await open(page, 'classic');
      const main = page.getByRole('main');
      const checkbox = page.getByTestId('row-read-1').getByRole('checkbox');

      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
      await expect(main).toHaveAttribute('data-opened', '');

      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');

      await page
        .getByTestId('row-unread-2')
        .getByText('Can we move the review?', { exact: true })
        .click();
      await expect(main).toHaveAttribute('data-opened', 'unread-2');
    });
  });
}
