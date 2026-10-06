// Run after the same MCP agent receives the real feedback prompt, edits, captures, and replies.
import { lab, assert, openSearch } from './lab.mjs';
import fs from 'node:fs/promises';
const port = Number(process.argv[2] || 7117);
const directory = process.argv[3] || '/tmp/macro-review-public';
const state = JSON.parse(
  await fs.readFile(`${directory}/browser-state-${port}.json`, 'utf8')
);
const h = await lab(port);
try {
  const { page, root, api } = h;
  const review = (await api('/review')).review;
  const thread = review.threads.find((t) => t.id === state.thread);
  assert(
    thread?.messages.some((m) => m.author.kind === 'agent'),
    'Agent must reply through MCP first'
  );
  assert(!thread.resolved, 'Agent resolved the human thread');
  const anchor = review.anchors.find((a) => a.id === thread.anchor);
  assert(
    anchor.status === 'moved',
    'Edited code did not relocate the selected range'
  );
  const latest = review.revisions.at(-1).number;
  assert(latest > state.revision, 'Agent did not publish a new revision');
  const code = root.locator(`[data-review-file=${JSON.stringify(state.path)}]`);
  const original = new URL(state.link.url);
  original.searchParams.set('s0.review.thread', state.thread);
  await h.open(original.search);
  await root
    .getByRole('button', { name: 'View latest', exact: true })
    .waitFor({ timeout: 60000 });
  await root
    .getByRole('region', { name: 'Review thread', exact: true })
    .getByText('Agent', { exact: true }).first()
    .waitFor({ timeout: 60000 });
  assert(
    new URL(page.url()).searchParams.get('s0.review.revision') ===
      String(state.revision),
    'Historical citation silently advanced'
  );
  await code
    .getByRole('button', {
      name: `Select new line ${anchor.original.line}`,
      exact: true,
    })
    .waitFor();
  await root.getByRole('button', { name: 'View latest', exact: true }).click();
  await root.getByText('Threads', { exact: true }).first().click();
  await root
    .locator('aside')
    .getByRole('button')
    .filter({ hasText: state.comment })
    .last()
    .click();
  const reply = thread.messages.findLast((message) => message.author.kind === 'agent');
  const replyUrl = reply.body.match(/https?:[^\s)]+review.target=[^\s)]+/)?.[0];
  assert(replyUrl, 'Agent reply has no code link');
  const replyTarget = new URL(replyUrl).searchParams.get('s0.review.target');
  const discussion = root.getByRole('region', {
    name: 'Review thread',
    exact: true,
  }).filter({has: page.locator(`a[href*="review.target=${replyTarget}"]`)});
  await discussion
    .getByText('Agent', { exact: true }).first()
    .waitFor();
  await code
    .getByRole('button', {
      name: `Select new line ${anchor.current.line}`,
      exact: true,
    })
    .waitFor();
  const citation = discussion.locator('a[href*="review.target"]').first();
  const href = await citation.getAttribute('href');
  assert(href, 'Agent reply has no rendered code citation');
  const target = new URL(href).searchParams.get('s0.review.target');
  const updated = review.anchors.find((a) => a.id === target);
  assert(updated, 'Reply referenced an unknown target');
  await citation.click();
  await code
    .getByRole('button', {
      name: `Select ${updated.original.side} line ${updated.original.line}`,
      exact: true,
    })
    .waitFor();
  assert(
    new URL(page.url()).searchParams.get('s0.review.target') === target,
    'Reply link did not navigate within reader'
  );
  // Reopen the exact same citation after navigating away, with a real anchor click.
  await openSearch(root);
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('500');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  await root
    .getByRole('button', { name: 'Back to session', exact: true })
    .click();
  await root.locator('textarea').evaluate((element, href) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = 'Open cited code';
    element.parentElement.append(link);
  }, href);
  await root
    .getByRole('link', { name: 'Open cited code', exact: true })
    .click();
  await code
    .getByRole('button', {
      name: `Select ${updated.original.side} line ${updated.original.line}`,
      exact: true,
    })
    .waitFor();
  assert(
    !(await code
      .getByRole('button', { name: 'Select new line 500', exact: true })
      .isVisible()),
    'Repeated citation retained unrelated local navigation'
  );
  await root.getByText('Threads', { exact: true }).first().click();
  await root
    .locator('aside')
    .getByRole('button')
    .filter({ hasText: state.comment })
    .last()
    .click();
  await discussion
    .getByRole('button', { name: 'Resolve', exact: true })
    .click();
  await discussion
    .getByRole('button', { name: 'Reopen', exact: true })
    .waitFor();
  assert(
    (await api('/review')).review.threads.find((t) => t.id === thread.id)
      .resolved,
    'Resolve was not durable'
  );
  await discussion.getByRole('button', { name: 'Reopen', exact: true }).click();
  await discussion
    .getByRole('button', { name: 'Resolve', exact: true })
    .waitFor();
  // Responsive columns keep both sources inside the pane.
  const columns = await root
    .locator('[data-review-row]')
    .first()
    .locator(':scope > div')
    .evaluateAll((elements) =>
      elements.map((el) => ({
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
      }))
    );
  assert(
    columns.length === 2 && columns[1].right <= 1440,
    'Side-by-side column left viewport'
  );
  await root.screenshot({
    path: `${directory}/revision-${port}-desktop.png`,
    timeout: 15000,
  });
  // Reloadable read-only links still allow selection, without mutation.
  const readOnly = new URL(href);
  readOnly.searchParams.set('s0.review.readonly', 'true');
  await h.open(readOnly.search);
  await code
    .getByRole('button', {
      name: `Select ${updated.original.side} line ${updated.original.line}`,
      exact: true,
    })
    .waitFor({ timeout: 60000 });
  await code
    .getByRole('button', {
      name: `Select ${updated.original.side} line ${updated.original.line}`,
      exact: true,
    })
    .click();
  assert(
    (await root
      .getByRole('textbox', { name: 'Comment on this code' })
      .count()) === 0,
    'Viewer received an editor'
  );
  assert(await root.getByRole('button', { name: 'Ask agent', exact: true }).count() === 0,
    'Viewer received an Ask agent action');
  await page.setViewportSize({ width: 390, height: 844 });
  await root.screenshot({
    path: `${directory}/revision-${port}-mobile.png`,
    timeout: 15000,
  });
  assert(
    await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'Mobile overflow after linked navigation'
  );
  assert(h.errors.length === 0, `Browser errors: ${h.errors.join('; ')}`);
  console.log(
    JSON.stringify({
      pass: true,
      files: review.revisions.at(-1).files.length,
      originalRevision: state.revision,
      latest,
      originalLine: anchor.original.line,
      movedLine: anchor.current.line,
      agentReplies: thread.messages.filter((m) => m.author.kind === 'agent')
        .length,
      checks: [
        'historic links',
        'moved thread',
        'reply markdown link',
        'repeat citation',
        'resolve/reopen',
        'responsive wrapped panes',
        'read-only selection/copy',
        'reload',
        'mobile',
      ],
    })
  );
} finally {
  await h.context.close();
}
process.exit(0);
