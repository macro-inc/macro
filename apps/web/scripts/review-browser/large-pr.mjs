// Run after an agent publishes a review through review_lab's actual Internal MCP.
import { lab, assert, openFile, openSearch } from './lab.mjs';
import fs from 'node:fs/promises';
const port = Number(process.argv[2] || 7117);
const directory = process.argv[3] || '/tmp/macro-review-public';
const h = await lab(port);
try {
  const { page, root, api } = h;
  const review = (await api('/review')).review;
  assert(review, 'Publish a review through Internal MCP first');
  const revision = review.revisions.at(-1);
  const path =
    port === 7117
      ? 'src/compiler/checker.ts'
      : 'compiler/rustc_middle/src/ty/sty.rs';
  const body = await api(
    `/review/file?revision=${revision.number}&path=${encodeURIComponent(path)}`
  );
  console.log(
    JSON.stringify({
      files: revision.files.length,
      sourceLines: body.new.lines.length,
      tour: review.tour.length,
    })
  );
  const code = root.locator(`[data-review-file=${JSON.stringify(path)}]`);
  await h.open();
  await root
    .getByRole('textbox', { name: 'Session message draft' })
    .fill('Preserve the session draft during review');
  const started = Date.now();
  await root.getByRole('button', { name: 'Review changes' }).click();
  await root
    .getByRole('heading', { name: review.title, exact: true })
    .waitFor({ timeout: 60000 });
  if (review.tour.length) {
    await root.getByText('Walkthrough', { exact: true }).first().click();
    await root
      .getByRole('heading', { name: review.tour[0].title, exact: true })
      .waitFor();
    if (review.tour.length > 1) {
      await root.getByRole('button', { name: /^Next/ }).click();
      await root
        .getByRole('heading', { name: review.tour[1].title, exact: true })
        .waitFor();
      await root.getByRole('button', { name: 'Previous chapter', exact: true }).click();
    }
  }
  assert((await root.locator('aside button[title]').count()) < 100, 'File tree mounted all files');
  await openFile(root, page, path);
  await code.locator('[data-review-row]').first().waitFor({timeout:60000});
  await root.getByRole('complementary', {name:'Review navigation', exact:true})
    .locator('label').filter({hasText:/^Full Diff$/}).click();
  await openSearch(root);
  // Jump to a line outside the mounted window in the actual full source.
  const last = body.new.lines.length;
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill(String(last));
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await code
    .getByRole('button', { name: `Select new line ${last}`, exact: true })
    .waitFor();
  const rows = await root.locator('[data-review-row]').count();
  assert(rows < 200, `Unbounded mounted code rows: ${rows}`);
  console.log(
    JSON.stringify({
      openAndJumpMs: Date.now() - started,
      mountedRows: rows,
      lastLine: last,
    })
  );
  // Search exact source text from deep inside the file, not just rendered DOM.
  let index = Math.floor(last * 0.7);
  while (
    index < last - 1 &&
    (body.new.lines[index].trim().length < 35 ||
      body.new.lines[index].trim().length > 160)
  )
    index++;
  const needle = body.new.lines[index].trim();
  await root.getByRole('textbox', { name: 'Find in file' }).fill(needle);
  await page.waitForTimeout(500);
  assert(
    (await root.locator('[data-review-row]').allTextContents()).some((text) =>
      text.includes(needle)
    ),
    'Offscreen search failed'
  );
  await root.getByRole('textbox', { name: 'Find in file' }).fill('');
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('12');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await code
    .getByRole('button', { name: 'Select new line 12', exact: true })
    .click();
  await code
    .getByRole('button', { name: 'Select new line 14', exact: true })
    .click({ modifiers: ['Shift'] });
  await root.getByRole('button', {name:'Ask agent', exact:true}).click();
  h.failNextCommentResponse();
  const comment =
    `Browser check ${Date.now()}: add only a short explanatory comment above this import block. Keep behavior unchanged. Refresh the review and reply in this thread with a link to the updated code.`;
  await root
    .getByRole('textbox', { name: 'Comment on this code' })
    .fill(comment);
  await root.getByRole('button', { name: 'Comment', exact: true }).click();
  await root
    .getByRole('button', { name: 'Retry comment', exact: true })
    .waitFor();
  await root
    .getByRole('button', { name: 'Retry comment', exact: true })
    .click();
  await root
    .getByText('Comment saved', {
      exact: true,
    })
    .waitFor();
  assert(
    h.writes.length === 2 && h.writes[0].id === h.writes[1].id,
    'Retry changed message identity'
  );
  const after = (await api('/review')).review;
  const thread = after.threads.find((t) =>
    t.messages.some((m) => m.id === h.writes[0].id)
  );
  assert(
    thread.messages.length === 1,
    'Uncertain response created duplicate comments'
  );
  assert(h.writes[0].location.endLine === 14, 'Range selection was lost');
  const link = await api('/review/link', {
    revision: revision.number,
    location: h.writes[0].location,
  });
  await fs.writeFile(
    `${directory}/browser-state-${port}.json`,
    JSON.stringify({
      link,
      thread: thread.id,
      comment,
      revision: revision.number,
      path,
    })
  );
  await root
    .getByRole('button', { name: 'Back to session', exact: true })
    .click();
  assert(
    (await root
      .getByRole('textbox', { name: 'Session message draft' })
      .inputValue()) === 'Preserve the session draft during review',
    'Back lost draft'
  );
  await root.getByRole('button', { name: 'Review changes' }).click();
  await root.screenshot({
    path: `${directory}/large-pr-${port}-desktop.png`,
    timeout: 15000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await root
    .getByRole('button', { name: 'Review navigation', exact: true })
    .click();
  await root.getByText('Walkthrough', { exact: true }).first().click();
  await root.locator('[data-review-navigation-scroll]').evaluate((el) => {
    el.scrollTop = 0;
  });
  await root
    .locator(`button[title="${review.tour[0].title}"]`)
    .click();
  await root.screenshot({
    path: `${directory}/large-pr-${port}-mobile.png`,
    timeout: 15000,
  });
  const bounds = await root.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
  }));
  assert(bounds.scroll <= bounds.width + 1, 'Mobile horizontal page overflow');
  assert(h.errors.length === 0, `Browser exceptions: ${h.errors.join('; ')}`);
  console.log(
    'PASS real PR, MCP tour, virtualized files/code, offscreen search, range comment, uncertain-response retry, Back/draft, mobile'
  );
} finally {
  await h.context.close();
}
process.exit(0);
