// Alters only the disposable checkout, after revisions.mjs has passed.
import { lab, assert } from './lab.mjs';
import fs from 'node:fs/promises';
const h = await lab(7117);
try {
  const state = JSON.parse(
    await fs.readFile(
      '/tmp/macro-review-public/browser-state-7117.json',
      'utf8'
    )
  );
  const review = (await h.api('/review')).review;
  const thread = review.threads.find((t) => t.id === state.thread),
    anchor = review.anchors.find((a) => a.id === thread.anchor);
  if (anchor.status !== 'outdated') {
    const path = `/tmp/macro-review-public/typescript/${state.path}`;
    const lines = (await fs.readFile(path, 'utf8')).split('\n');
    lines.splice(
      anchor.current.line,
      0,
      '    // Local review test: preserve original context when this range changes.'
    );
    await fs.writeFile(path, lines.join('\n'));
    await h.api('/review/capture', {});
  }
  const updated = (await h.api('/review')).review;
  assert(
    updated.anchors.find((a) => a.id === anchor.id).status === 'outdated',
    'Changed excerpt was attached to unrelated code'
  );
  await h.open(
    `?s0.review.open=true&s0.review.revision=${updated.revisions.at(-1).number}`
  );
  await h.root.getByText('Threads', { exact: true }).first().click();
  const item = h.root
    .locator('aside')
    .getByRole('button')
    .filter({ hasText: state.comment });
  await item
    .getByText('Outdated · original context preserved', { exact: true })
    .waitFor();
  await item.click();
  await h.root
    .getByRole('region', { name: 'Review thread', exact: true })
    .waitFor();
  assert(
    new URL(h.page.url()).searchParams.get('s0.review.revision') ===
      String(anchor.revision),
    'Outdated thread did not open its original revision'
  );
  await h.root
    .locator(`[data-review-file=${JSON.stringify(anchor.original.path)}]`)
    .getByRole('button', {
      name: `Select new line ${anchor.original.line}`,
      exact: true,
    })
    .waitFor();
  await h.root.screenshot({
    path: '/tmp/macro-review-public/outdated-original.png',
  });
  assert(h.errors.length === 0, h.errors.join('; '));
  console.log(
    JSON.stringify({
      pass: true,
      latest: updated.revisions.at(-1).number,
      original: anchor.revision,
      check:
        'Changed range is outdated; original source and thread remain reachable',
    })
  );
} finally {
  await h.context.close();
}
process.exit(0);
