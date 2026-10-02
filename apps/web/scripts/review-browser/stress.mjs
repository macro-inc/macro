import { lab, assert, openFile as navigateFile, openSearch } from './lab.mjs';
const h = await lab(7119);
try {
  const response = await fetch('http://localhost:7119/mcp/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer review-lab-only',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'diff',
        arguments: {
          comparison: { worktree: true },
          presentation: {
            title: '100,000-line review stress',
            summary: 'Full source and mixed file types.',
          },
        },
      },
    }),
  });
  const rpc = await response.json();
  assert(!rpc.error && !rpc.result?.isError, JSON.stringify(rpc));
  const { root, page } = h;
  await h.open();await page.bringToFront();
  await root.getByRole('button', { name: 'Review changes' }).click();
  let currentPath;
  const openFile=async(path)=>{currentPath=path;await navigateFile(root,page,path);};
  const code=()=>root.locator(`[data-review-file="${currentPath}"]`);
  await openFile('src/large.ts');
  await root.locator('[data-review-row]').first().waitFor({ timeout: 60000 });
  await openSearch(root);
  const start = Date.now();
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('100000');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await code()
    .getByRole('button', { name: 'Select new line 100000', exact: true })
    .waitFor();
  const latency = Date.now() - start,
    rows = await root.locator('[data-review-row]').count();
  assert(rows < 150, `100k file mounted ${rows} rows`);
  await code()
    .getByRole('button', { name: 'Select new line 99999', exact: true })
    .click();
  await code()
    .getByRole('button', { name: 'Select new line 100000', exact: true })
    .click({ modifiers: ['Shift'] });
  await root
    .getByRole('button', { name: 'Copy link to selected range', exact: true })
    .first()
    .click();
  await root
    .getByText('Link to this revision copied', { exact: true })
    .waitFor();
  const saved = (await h.api('/review')).review;
  assert(
    saved.anchors.some(
      (a) => a.original.line === 99999 && a.original.endLine === 100000
    ),
    'Range citation lost its end line'
  );
  const large = saved.revisions
    .at(-1)
    .files.find((file) => file.path === 'src/large.ts');
  assert(
    large.added === 3 && large.removed === 3,
    `Sparse change statistics were inflated: ${JSON.stringify(large)}`
  );
  assert(
    (await root.getByRole('textbox', { name: 'Comment on this code' }).count()) === 0,
    'Clicking outside an empty composer did not dismiss it'
  );
  await root
    .getByRole('textbox', { name: 'Find in file' })
    .fill('export const v75000');
  const searchStarted=Date.now();await page.waitForFunction(()=>[...document.querySelectorAll('[data-review-row]')].some(el=>el.textContent.includes('v75000')),null,{timeout:5000});console.log(JSON.stringify({stage:'deep-search',milliseconds:Date.now()-searchStarted}));
  assert(
    (await root.locator('[data-review-row]').allTextContents()).some((t) =>
      t.includes('v75000')
    ),
    'Deep search failed'
  );
  // Adjacent matches advance once each; repeating the query starts at the first.
  const find = root.getByRole('textbox', {name: 'Find in file', exact: true});
  const currentMatch = () => code().locator('[data-review-match="current"] [data-review-side="new"]').getAttribute('data-review-line');
  await find.fill('export const');
  await page.waitForTimeout(100);
  assert(await currentMatch() === '1', 'Search did not start at its first match');
  await root.getByRole('button', {name:'Next match ↓', exact:true}).click();
  await page.waitForTimeout(100);
  assert(await currentMatch() === '2', 'Next repeated the centered match');
  await root.getByRole('button', {name:'Next match ↓', exact:true}).click();
  await page.waitForTimeout(100);
  assert(await currentMatch() === '3', 'Next skipped an adjacent match');
  await find.press('Escape');
  await openSearch(root);
  await find.fill('export const');
  await page.waitForTimeout(100);
  assert(await currentMatch() === '1', 'Reopening a query retained the old match cursor');
  await find.fill('');
  await openFile('src/wide.ts');
  await code()
    .getByRole('button', { name: 'Select new line 2', exact: true })
    .waitFor();
  const tail = await code()
    .locator('code > span')
    .filter({ hasText: 'HORIZONTAL_TAIL' })
    .evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf('HORIZONTAL_TAIL');
        if (i >= 0) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 15);
          const a = range.getBoundingClientRect(),
            b = el.parentElement.getBoundingClientRect();
          return {
            visible: a.left >= b.left && a.right <= b.right,
            text: a.toJSON(),
            cell: b.toJSON(),
            transform: el.style.transform,
          };
        }
      }
      return false;
    });
  assert(
    tail.visible,
    `Tabs/CJK line tail is inaccessible: ${JSON.stringify(tail)}`
  );
  assert(
    (await root.locator('code img').count()) === 0,
    'Source HTML was not escaped'
  );
  await openFile('image.png');
  await code()
    .getByText('Binary file — contents are not text.', { exact: true })
    .waitFor();
  await openFile('empty.ts');
  await code()
    .getByText('This file has no text changes.', { exact: true })
    .waitFor();
  await openFile('src/deleted.rs');
  await code()
    .getByRole('button', { name: 'Select old line 1', exact: true })
    .waitFor();
  await code()
    .getByRole('button', { name: 'Select old line 1', exact: true })
    .click();
  await root
    .getByRole('button', { name: 'Copy link to this line', exact: true })
    .click();
  await root
    .getByText('Link to this revision copied', { exact: true })
    .waitFor();
  assert(
    (await root.getByRole('textbox', { name: 'Comment on this code' }).count()) === 0,
    'Copying an old-side citation left an empty composer open'
  );
  await openFile('package-lock.json');
  const expand = code().getByRole('button', { name: 'Expand file', exact: true });
  await expand.waitFor();
  await expand.click();
  await code()
    .getByRole('button', { name: 'Select new line 1', exact: true })
    .waitFor();

  await page.setViewportSize({ width: 1440, height: 600 });
  await page.waitForTimeout(300);
  const nav = root.getByRole('complementary', { name: 'Review navigation', exact: true });
  const choose = async (name) => nav.locator('label').filter({hasText: new RegExp(`^${name}$`)}).click();
  await choose('Full Diff');
  const folder = nav.getByRole('button', { name: 'src', exact: true });
  assert(await folder.getAttribute('aria-expanded') === 'true', 'Full Diff folders should start expanded');
  await folder.click();
  await choose('Walkthrough');
  await choose('Full Diff');
  assert(await folder.getAttribute('aria-expanded') === 'false', 'Full Diff lost its folder disclosure state');
  await folder.click();
  await nav.getByRole('button', { name: 'src/deleted.rs', exact: true }).click();
  const reader = root.locator('[data-review-scroll]');
  const bounds = await reader.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('[data-review-scroll]')?.getAttribute('aria-label') === 'Code changes in src/large.ts');
  await page.waitForTimeout(250);
  const largeSection = root.locator('[data-review-file="src/large.ts"]');
  const top = (await largeSection.boundingBox()).y;
  const previousBounds = await root.locator('[data-review-file="src/deleted.rs"]').boundingBox();
  assert(previousBounds.y + previousBounds.height <= bounds.y, 'Resize regression requires a fully preceding file');
  const previousRow = root.locator('[data-review-file="src/deleted.rs"] [data-review-row]').last();
  await previousRow.evaluate(el => { el.style.minHeight = `${el.clientHeight + 100}px`; });
  await page.waitForTimeout(300);
  assert(Math.abs((await largeSection.boundingBox()).y - top) <= 1, 'A preceding file resize moved the visible source');
  await previousRow.evaluate(el => { el.style.minHeight = ''; });
  await page.waitForTimeout(300);
  assert(Math.abs((await largeSection.boundingBox()).y - top) <= 1, 'Restoring a preceding file size moved the source');
  await openFile('src/large.ts');
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('100000');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await root.screenshot({ path: '/tmp/macro-review-public/stress-100k.png' });
  assert(h.errors.length === 0, h.errors.join('; '));
  console.log(
    JSON.stringify({
      pass: true,
      sourceLines: 100000,
      jumpMs: latency,
      mountedRows: rows,
      checks: [
        'real MCP capture',
        'deep search',
        'adjacent matches and query reset',
        'tabs/CJK wrapped extent',
        'escaped HTML',
        'binary',
        'empty',
        'deleted-old-side citation',
        'generated',
        '100k virtualization',
        'expanded Full Diff tree with retained disclosure',
        'continuous wheel scrolling across files',
        'single compensation for preceding file resize',
      ],
    })
  );
} finally {
  await h.context.close();
}
process.exit(0);
