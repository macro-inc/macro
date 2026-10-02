// Uses the 100k stress fixture on port 7119.
import { lab, assert, openFile, openSearch } from './lab.mjs';
const h = await lab(7119, { viewport: { width: 1440, height: 600 } });
try {
  const { root, page } = h;
  await h.open();
  await root.getByRole('button', { name: 'Review changes' }).click();
  await openFile(root, page, 'src/large.ts');
  await root.locator('[data-review-row]').first().waitFor({ timeout: 60000 });
  await openSearch(root);
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('50000');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await root.getByRole('textbox', { name: 'Find in file' }).press('Escape');
  await page.waitForTimeout(300);
  const line = root.locator(
    '[data-review-side="new"][data-review-line="50000"]'
  );
  await line.waitFor();
  const before = await line.boundingBox();
  const arrows = root.getByRole('button', {
    name: 'Show 10 lines above',
    exact: true,
  });
  let fold;
  const scroller = await root.locator('[data-review-scroll]').boundingBox();
  for (const arrow of await arrows.all()) {
    const b = await arrow.boundingBox();
    if (b.y >= scroller.y && b.y < before.y) fold = arrow;
  }
  assert(fold, 'visible up edge');
  const count = Number(
    (await fold.evaluate((el) => el.closest('div.border-y').innerText)).replace(
      /[^0-9]/g,
      ''
    )
  );
  await fold.click();
  await page.waitForTimeout(250);
  const after = await line.boundingBox();
  assert(
    Math.abs(after.y - before.y) <= 2,
    `Expanding up moved code ${after.y - before.y}px`
  );
  assert(
    (await root
      .getByRole('button', {
        name: `${(count - 10).toLocaleString()} unchanged lines`,
        exact: true,
      })
      .count()) > 0,
    'Up expanded both ends instead of ten lines'
  );
  const above = await root
    .locator('[data-review-side="new"]')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.reviewLine)));
  console.log(
    JSON.stringify({
      upDelta: after.y - before.y,
      countBefore: count,
      countAfter: count - 10,
      visibleRange: [Math.min(...above), Math.max(...above)],
    })
  );
  let down;
  const current = await line.boundingBox();
  for (const arrow of await root
    .getByRole('button', { name: 'Show 10 lines below', exact: true })
    .all()) {
    const b = await arrow.boundingBox();
    if (b.y > current.y && b.y < scroller.y + scroller.height) {
      down = arrow;
      break;
    }
  }
  assert(down, 'visible down edge');
  const downCount = Number(
    (await down.evaluate((el) => el.closest('div.border-y').innerText)).replace(
      /[^0-9]/g,
      ''
    )
  );
  const beforeDown = await line.boundingBox();
  await down.click();
  await page.waitForTimeout(250);
  const afterDown = await line.boundingBox();
  assert(
    Math.abs(afterDown.y - beforeDown.y) <= 2,
    `Expanding down moved code ${afterDown.y - beforeDown.y}px`
  );
  assert(
    (await root
      .getByRole('button', {
        name: `${(downCount - 10).toLocaleString()} unchanged lines`,
        exact: true,
      })
      .count()) > 0,
    'Down expanded both ends'
  );
  const scroll = root.locator('[data-review-scroll]');
  const saved = await scroll.evaluate((el) => el.scrollTop);
  const mounted = await scroll.elementHandle();
  await scroll.focus();
  const captured = page.waitForResponse(
    (response) => response.url().endsWith('/review/capture')
  );
  await page.keyboard.press('r');
  await captured;
  await page.waitForTimeout(500);
  assert(await mounted.evaluate((el) => el.isConnected), 'Refresh detached code');
  assert(
    Math.abs((await scroll.evaluate((el) => el.scrollTop)) - saved) <= 2,
    'Refresh moved the viewport'
  );
  assert(!h.errors.length, h.errors.join(';'));
  console.log('PASS directional context, viewport preservation, and r refresh');
} catch (e) {
  await h.page.screenshot({
    path: '/tmp/macro-review-public/context-failure.png',
  });
  throw e;
} finally {
  await h.context.close();
}
process.exit(0);
