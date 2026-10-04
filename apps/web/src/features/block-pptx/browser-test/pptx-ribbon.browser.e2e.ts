import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function outline(page: Page) {
  return page.evaluate(async () => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return engine.outline();
  });
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function goToSlide(page: Page, index: number) {
  await page.getByTestId('pptx-thumbnail').nth(index).click();
  await expect(page.getByTestId('pptx-thumbnail').nth(index)).toHaveAttribute(
    'aria-current',
    'true'
  );
}

/** The title of slide 1 (id 256, shape 2). */
async function selectTitle(page: Page) {
  const at = await screen(page, 480, 226);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
}

test('formats text from the ribbon', async ({ page }) => {
  await open(page);
  await selectTitle(page);
  const size = page.getByTestId('pptx-font-size');
  await size.fill('54');
  await size.press('Enter');
  await page.getByRole('button', { name: 'Strikethrough' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const layout = await window.pptxFixture.engine()?.textLayout(0, 2);
        const run = layout?.styles[0]?.runs[0];
        return run && { size: run.size, strike: run.strike };
      })
    )
    .toEqual({ size: 54, strike: true });
});

test('right-click menus act on what was clicked', async ({ page }) => {
  await open(page);
  const at = await screen(page, 480, 226);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Bring to front' })
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect
    .poll(async () =>
      (await outline(page)).slides[0].shapes.some((s) => s.id === 2)
    )
    .toBe(false);
  // The empty slide offers slide commands.
  const empty = await screen(page, 480, 480);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Format background…' })
  ).toBeVisible();
});

test('selects shapes with a marquee and aligns them', async ({ page }) => {
  await open(page);
  await goToSlide(page, 2);
  // Nudge the second card down so aligning has something to do.
  const card = await screen(page, 360, 200);
  await page.mouse.click(card.x, card.y);
  await page.keyboard.press('Shift+ArrowDown');
  const from = await screen(page, 30, 120);
  const to = await screen(page, 940, 380);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(
    page.getByTestId('pptx-selection-outline').first()
  ).toBeVisible();
  const count = await page.getByTestId('pptx-selection-outline').count();
  expect(count).toBeGreaterThan(4);
  await page.getByTestId('pptx-arrange').click();
  await page.getByRole('button', { name: 'Align top' }).click();
  await expect
    .poll(async () => {
      const cards = (await outline(page)).slides[2].shapes.filter(
        (s) => s.kind === 'shape' && s.w > 150 && s.w < 400
      );
      return new Set(cards.map((s) => Math.round(s.y))).size;
    })
    .toBe(1);
});

test('groups shapes, pastes them on another slide, and ungroups', async ({
  page,
}) => {
  await open(page);
  await goToSlide(page, 2);
  const from = await screen(page, 30, 120);
  const to = await screen(page, 940, 380);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+g');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[2].shapes.filter((s) => s.kind === 'group')
          .length
    )
    .toBe(1);
  await page.keyboard.press('ControlOrMeta+c');
  await goToSlide(page, 7);
  await page.getByTestId('pptx-stage').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[7].shapes.filter((s) => s.kind === 'group')
          .length
    )
    .toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[7].shapes.filter((s) => s.kind === 'group')
          .length
    )
    .toBe(0);
});

test('edits table cells in place and merges a range', async ({ page }) => {
  await open(page);
  await goToSlide(page, 5);
  const table = (await outline(page)).slides[5].shapes.find(
    (s) => s.kind === 'table'
  );
  if (!table?.table) throw new Error('No table on slide 6.');
  const xs = [table.x];
  for (const w of table.table.columnWidths) xs.push(xs[xs.length - 1] + w);
  const ys = [table.y];
  for (const h of table.table.laidOutRowHeights) ys.push(ys[ys.length - 1] + h);
  const cell = (r: number, c: number) =>
    screen(page, (xs[c] + xs[c + 1]) / 2, (ys[r] + ys[r + 1]) / 2);
  const a = await cell(1, 1);
  await page.mouse.click(a.x, a.y);
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.press('End');
  await page.keyboard.type(' est.');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[5].shapes.find((s) => s.id === table.id)
          ?.table?.rows[1][1]
    )
    .toBe('84.2 est.');
  await page.keyboard.press('Escape');
  const b = await cell(2, 2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('pptx-cell-range')).toBeVisible();
  await page.getByTestId('pptx-tab-table-layout').click();
  await page.getByTestId('pptx-merge-cells').click();
  await expect
    .poll(async () => {
      const t = (await outline(page)).slides[5].shapes.find(
        (s) => s.id === table.id
      )?.table;
      return t && [t.cells[1][1].rowSpan, t.cells[1][1].colSpan];
    })
    .toEqual([2, 2]);
});

test('inserts a chart and edits its data', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-chart').click();
  await page.getByTestId('pptx-chart-column-clustered').click();
  await expect(page.getByTestId('pptx-chart-data')).toBeVisible();
  await page.getByTestId('pptx-chart-cell-0-1').fill('Revenue');
  await page.getByTestId('pptx-chart-cell-1-1').fill('9.5');
  await page.getByTestId('pptx-chart-apply').click();
  await expect
    .poll(async () => {
      const chart = (await outline(page)).slides[0].shapes.find(
        (s) => s.kind === 'chart'
      )?.chart;
      return (
        chart && [chart.kind, chart.series[0].name, chart.series[0].values[0]]
      );
    })
    .toEqual(['column', 'Revenue', 9.5]);
  await page.getByTestId('pptx-tab-chart-design').click();
  await page.getByTestId('pptx-chart-type').click();
  await page.getByTestId('pptx-chart-line-standard').click();
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.kind === 'chart')
          ?.chart?.kind
    )
    .toBe('line');
});

test('finds and replaces text across the deck', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-stage').focus();
  await page.keyboard.press('ControlOrMeta+h');
  await page.getByTestId('pptx-find-input').fill('Northwind');
  await expect(page.getByTestId('pptx-find-count')).toContainText('of');
  await page.getByTestId('pptx-replace-input').fill('Contoso');
  await page.getByTestId('pptx-replace-all').click();
  await expect
    .poll(async () => JSON.stringify(await outline(page)).includes('Northwind'))
    .toBe(false);
  expect(JSON.stringify(await outline(page))).toContain('Contoso Analytics');
});

test('sets transitions and plays the slide show', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-tab-transitions').click();
  await page.getByTestId('pptx-transition-push').click();
  await page.getByTestId('pptx-transition-all').click();
  await expect
    .poll(async () =>
      (await outline(page)).slides.every((s) => s.transition?.kind === 'push')
    )
    .toBe(true);
  await page.getByTestId('pptx-tab-slideshow').click();
  await page.getByTestId('pptx-present-start').click();
  const show = page.getByTestId('pptx-slideshow');
  await expect(show).toBeVisible();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 8');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('2 / 8');
  await page.keyboard.press('Escape');
  await expect(show).toBeHidden();
  await expect(page.getByTestId('pptx-thumbnail').nth(1)).toHaveAttribute(
    'aria-current',
    'true'
  );
});

test('recolors and refonts the deck from Design variants', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-tab-design').click();
  await page.getByTestId('pptx-theme-colors').click();
  await page.getByTestId('pptx-theme-colors-Red Violet').click();
  await page.getByTestId('pptx-theme-fonts').click();
  await page.getByTestId('pptx-theme-fonts-Georgia').click();
  const theme = async () => {
    const deck = await outline(page);
    return {
      accent1: deck.themeColors.find(([slot]) => slot === 'accent1')?.[1],
      fonts: deck.themeFonts,
    };
  };
  await expect.poll(theme).toEqual({
    accent1: '#E32D91',
    fonts: { major: 'Georgia', minor: 'Georgia' },
  });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(theme).toEqual({
    accent1: '#E32D91',
    fonts: { major: 'Calibri', minor: 'Calibri' },
  });
});

test('paints formatting with the format painter', async ({ page }) => {
  await open(page);
  // Subtitle (gray, 32 pt) → title.
  const subtitle = await screen(page, 480, 332);
  await page.mouse.click(subtitle.x, subtitle.y);
  await page.getByTestId('pptx-format-painter').click();
  await expect(page.getByTestId('pptx-stage')).toHaveAttribute(
    'data-format-painter',
    'true'
  );
  const title = await screen(page, 480, 229);
  await page.mouse.click(title.x, title.y);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const layout = await window.pptxFixture.engine()?.textLayout(0, 2);
        const run = layout?.styles[0]?.runs[0];
        return run && { size: run.size, color: run.color };
      })
    )
    .toEqual({ size: 32, color: '#8C8C8C' });
  // One click disarms it.
  await expect(page.getByTestId('pptx-stage')).not.toHaveAttribute(
    'data-format-painter'
  );
  // Double-click keeps painting until Escape: the accent band's fill.
  await goToSlide(page, 2);
  const bar = await screen(page, 480, 4);
  await page.mouse.click(bar.x, bar.y);
  await page.getByTestId('pptx-format-painter').dblclick();
  for (const [x, y] of [
    [140, 160],
    [360, 160],
  ]) {
    const at = await screen(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-stage')).not.toHaveAttribute(
    'data-format-painter'
  );
  await expect
    .poll(async () => {
      const deck = await outline(page);
      return deck.slides[2].shapes
        .filter((s) => s.id === 5 || s.id === 8)
        .map((s) => s.fill);
    })
    .toEqual(['#1F4E79', '#1F4E79']);
});

test('presents with Presenter View and an audience window', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-slideshow').click();
  const audience = page.context().waitForEvent('page');
  await page.getByTestId('pptx-present-presenter').click();
  const popup = await audience;
  await expect(page.getByTestId('pptx-presenter')).toBeVisible();
  await expect(page.getByTestId('pptx-presenter-counter')).toHaveText(
    'Slide 1 of 8'
  );
  await expect(popup.getByTestId('pptx-audience-canvas')).toHaveAttribute(
    'data-slide-index',
    '0'
  );
  await expect(page.getByTestId('pptx-presenter-next')).toHaveAttribute(
    'data-slide-index',
    '1'
  );
  // Either window advances the show.
  await page.keyboard.press('ArrowRight');
  await expect(popup.getByTestId('pptx-audience-canvas')).toHaveAttribute(
    'data-slide-index',
    '1'
  );
  await popup.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pptx-presenter-counter')).toHaveText(
    'Slide 3 of 8'
  );
  await page.getByTestId('pptx-presenter-grid-toggle').click();
  await page.getByRole('button', { name: 'Go to slide 6' }).click();
  await expect(page.getByTestId('pptx-presenter-current')).toHaveAttribute(
    'data-slide-index',
    '5'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-presenter')).toHaveCount(0);
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByTestId('pptx-thumbnail').nth(5)).toHaveAttribute(
    'aria-current',
    'true'
  );
});

test('prints and saves notes pages as a PDF', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ControlOrMeta+p');
  await expect(page.getByTestId('pptx-print')).toBeVisible();
  await expect(page.getByTestId('pptx-print-summary')).toHaveText('8 pages');
  await page.getByTestId('pptx-print-layout-handouts6').check();
  await expect(page.getByTestId('pptx-print-summary')).toHaveText('2 pages');
  await page.getByTestId('pptx-print-layout-notes').check();
  await page.getByTestId('pptx-print-range').fill('2-3');
  await expect(page.getByTestId('pptx-print-summary')).toHaveText('2 pages');
  const download = page.waitForEvent('download');
  await page.getByTestId('pptx-print-pdf').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('kitchen-sink-financial.pdf');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = Buffer.concat(chunks).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
  expect(pdf).toContain('/MediaBox [0 0 612 792]');
  await expect(page.getByTestId('pptx-print')).toHaveCount(0);
});

test('selects several slides and rearranges them in the slide sorter', async ({
  page,
}) => {
  await open(page);
  const ids = async () =>
    (await outline(page)).slides.map((s) => `${s.id}${s.hidden ? 'h' : ''}`);
  const rail = page.getByTestId('pptx-slide-rail');
  await rail.getByTestId('pptx-thumbnail').nth(1).click();
  await rail
    .getByTestId('pptx-thumbnail')
    .nth(3)
    .click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('pptx-status-selected')).toHaveText(
    '3 slides selected'
  );
  await rail.getByTestId('pptx-thumbnail').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide slides' }).click();
  await expect
    .poll(ids)
    .toEqual(['256', '257h', '258h', '259h', '260', '261', '262', '263']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await ids()).join(' ')).not.toContain('h');

  await page.getByTestId('pptx-view-sorter').click();
  const sorter = page.getByTestId('pptx-slide-sorter');
  const thumbs = sorter.getByTestId('pptx-thumbnail');
  await expect(thumbs).toHaveCount(8);
  await thumbs.nth(0).click();
  await thumbs.nth(4).click({ modifiers: ['ControlOrMeta'] });
  const from = await thumbs.nth(4).boundingBox();
  const to = await thumbs.nth(6).boundingBox();
  if (!from || !to) throw new Error('Thumbnails are not visible.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(ids)
    .toEqual(['257', '258', '259', '261', '262', '256', '260', '263']);
  await thumbs.nth(2).dblclick();
  await expect(page.getByTestId('pptx-stage')).toBeVisible();
  await expect(page.getByTestId('pptx-status-slide')).toHaveText(
    'Slide 3 of 8'
  );
});

test('remembers custom colors under Recent colors', async ({ page }) => {
  await open(page);
  await selectTitle(page);
  await page.getByTestId('pptx-fill').click();
  const picker = page.getByTestId('pptx-fill-colors');
  await expect(picker.getByTestId('pptx-recent-colors')).toHaveCount(0);
  await picker.getByTestId('pptx-more-colors').fill('#12a4b6');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.id === 2)?.fill
    )
    .toBe('#12A4B6');
  // The next picker offers it again.
  await page.getByTestId('pptx-fill').click();
  await expect(
    page
      .getByTestId('pptx-fill-colors')
      .getByTestId('pptx-recent-colors')
      .getByRole('button', { name: '#12A4B6' })
  ).toBeVisible();
});

test('Selection Pane selects, hides, renames, and reorders objects', async ({
  page,
}) => {
  await open(page);
  const order = async () =>
    (await outline(page)).slides[0].shapes.map((s) => s.id);
  const title = async () =>
    (await outline(page)).slides[0].shapes.find((s) => s.id === 2);
  const before = await order();
  await page.getByTestId('pptx-arrange').click();
  await page.getByTestId('pptx-selection-pane-toggle').click();
  const pane = page.getByTestId('pptx-selection-pane');
  await expect(pane).toBeVisible();
  const rows = pane.getByTestId('pptx-selection-row');
  // Topmost first.
  await expect(rows).toHaveCount(before.length);
  await expect(rows.first()).toHaveAttribute(
    'data-shape-id',
    String(before.at(-1))
  );
  const row = pane.locator('[data-shape-id="2"]');
  await row.click();
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected', 'true');

  // Hide it with the eye, then Show All.
  await row.getByTestId('pptx-selection-eye').click();
  await expect.poll(async () => (await title())?.hidden).toBe(true);
  await pane.getByTestId('pptx-selection-show-all').click();
  await expect.poll(async () => (await title())?.hidden).toBe(false);

  // Rename in place.
  await row.dblclick();
  await pane.getByTestId('pptx-selection-rename').fill('Headline');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await title())?.name).toBe('Headline');

  // Drag it above the topmost row: it moves to the front.
  await row.dragTo(rows.first(), { targetPosition: { x: 20, y: 3 } });
  await expect.poll(async () => (await order()).at(-1)).toBe(2);
  // Send Backward steps it back one place.
  await pane.locator('[data-shape-id="2"]').click();
  await pane.getByTestId('pptx-selection-backward').click();
  await expect.poll(async () => (await order()).at(-2)).toBe(2);
  // Alt+F10 closes it.
  await page.getByTestId('pptx-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+F10');
  await expect(pane).toBeHidden();
});

test('shows the ruler and gridlines and snaps moves to the grid', async ({
  page,
}) => {
  await open(page);
  await goToSlide(page, 2);
  await page.getByTestId('pptx-tab-view').click();
  await page.getByTestId('pptx-view-ruler').click();
  await page.getByTestId('pptx-view-gridlines').click();
  await expect(page.getByTestId('pptx-ruler-horizontal')).toBeVisible();
  await expect(page.getByTestId('pptx-ruler-vertical')).toBeVisible();
  await expect(page.getByTestId('pptx-gridlines')).toBeVisible();
  // Snap to a half-inch grid with smart guides off.
  await page.getByTestId('pptx-view-grid-settings').click();
  await page.getByTestId('pptx-view-snap-grid').check();
  await page.getByTestId('pptx-view-smart-guides').uncheck();
  await page.getByTestId('pptx-view-grid-spacing').selectOption('36');
  await page.keyboard.press('Escape');
  // Select the first card and drag it.
  const card = await screen(page, 140, 250);
  await page.mouse.click(card.x, card.y);
  await expect(page.getByTestId('pptx-ruler-span').first()).toBeVisible();
  const id = await page.evaluate(async () => {
    const deck = await window.pptxFixture.engine()?.outline();
    const s = deck?.slides[2].shapes.find(
      (x) => x.x < 140 && x.x + x.w > 140 && x.y < 250 && x.y + x.h > 250
    );
    return s?.id;
  });
  const to = await screen(page, 177, 281);
  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const s = (await outline(page)).slides[2].shapes.find((x) => x.id === id);
      return s && [Math.round(s.x * 100) % 3600, Math.round(s.y * 100) % 3600];
    })
    .toEqual([0, 0]);
  // The choices stay for the next visit.
  await page.reload();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
  await expect(page.getByTestId('pptx-gridlines')).toBeVisible();
});

test('exports slides as pictures and shapes with Save as Picture', async ({
  page,
}) => {
  await open(page);
  const read = async (download: import('@playwright/test').Download) => {
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    return readFileSync(path);
  };
  // One slide: a PNG of the chosen width.
  await page.getByTestId('pptx-export-open').click();
  await page.getByTestId('pptx-export-width').selectOption('1280');
  let download = page.waitForEvent('download');
  await page.getByTestId('pptx-export-run').click();
  let file = await download;
  expect(file.suggestedFilename()).toBe('kitchen-sink-financial - Slide1.png');
  let bytes = await read(file);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1280);
  // Every slide: JPEGs in a zip.
  await page.getByTestId('pptx-export-open').click();
  await page.getByTestId('pptx-export-jpeg').check();
  await page.getByTestId('pptx-export-all').check();
  download = page.waitForEvent('download');
  await page.getByTestId('pptx-export-run').click();
  file = await download;
  expect(file.suggestedFilename()).toBe('kitchen-sink-financial.zip');
  bytes = await read(file);
  const { unzipSync } = await import('fflate');
  const entries = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(entries).sort()).toEqual(
    Array.from({ length: 8 }, (_, i) => `Slide${i + 1}.jpg`).sort()
  );
  expect([...entries['Slide1.jpg'].subarray(0, 2)]).toEqual([0xff, 0xd8]);
  // A shape alone, cropped to it.
  const at = await screen(page, 480, 226);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Save as picture…' }).click();
  file = await download;
  expect(file.suggestedFilename()).toBe('Title 1.png');
  bytes = await read(file);
  const title = (await outline(page)).slides[0].shapes.find((s) => s.id === 2)!;
  // Rendered at 2 px per point.
  expect(bytes.readUInt32BE(16)).toBeCloseTo(title.w * 2, -1);
});

test('sets character spacing from the Home tab', async ({ page }) => {
  await open(page);
  await selectTitle(page);
  const spacing = () =>
    page.evaluate(async () => {
      const layout = await window.pptxFixture.engine()?.textLayout(0, 2);
      return layout?.styles[0].runs[0].spacing;
    });
  await page.getByTestId('pptx-char-spacing').click();
  await page.getByTestId('pptx-char-spacing-3').click();
  await expect.poll(spacing).toBe(3);
  await page.getByTestId('pptx-char-spacing').click();
  const custom = page.getByTestId('pptx-char-spacing-custom');
  await expect(custom).toHaveValue('3');
  await custom.fill('-1');
  await custom.press('Enter');
  await expect.poll(spacing).toBe(-1);
});
