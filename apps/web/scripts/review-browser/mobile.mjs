import { lab, assert, openFile, openSearch } from './lab.mjs';

const port = Number(process.argv[2] || 7118);
const h = await lab(port, {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
try {
  const { root } = h;
  const code = root.locator(`[data-review-file=${JSON.stringify('compiler/rustc_middle/src/ty/sty.rs')}]`);
  await h.open();
  await root
    .getByRole('textbox', { name: 'Session message draft' })
    .fill('Mobile draft survives review');
  await root.getByRole('button', { name: 'Review changes' }).click();
  await root.locator('[data-review-row]').first().waitFor({timeout:60000});
  assert(await root.locator('[data-review-row]').first().locator(':scope > div').count() === 1, 'Mobile should show one code column');
  await root.getByRole('button', {name:'Review navigation', exact:true}).click();
  await root.getByRole('button', {name:'Close review navigation', exact:true}).click();
  assert(!(await root.locator('aside').isVisible()), 'Mobile navigation cannot dismiss');
  await openFile(root, h.page, 'compiler/rustc_middle/src/ty/sty.rs');
  await root.locator('[data-review-row]').first().waitFor();
  assert(!(await root.locator('aside').isVisible()), 'File selection left drawer open');
  await openSearch(root);
  await root.getByRole('spinbutton', { name: 'Go to line' }).fill('500');
  await root.getByRole('spinbutton', { name: 'Go to line' }).press('Enter');
  const line = code.getByRole('button', {
    name: 'Select new line 500',
    exact: true,
  });
  await line.waitFor();
  await line.click();
  await root
    .getByRole('button', { name: 'Ask agent', exact: true })
    .click();
  await root.getByRole('textbox', { name: 'Comment on this code' }).waitFor();
  await root.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(
    (await root.getByRole('textbox', { name: 'Comment on this code' }).count()) === 0,
    'Cancelling the question left an empty composer open'
  );
  assert(
    await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'Mobile reader overflowed'
  );
  await root.screenshot({
    path: `/tmp/macro-review-public/mobile-unified-${port}.png`,
  });
  await root
    .getByRole('button', { name: 'Back to session', exact: true })
    .click();
  assert(
    (await root
      .getByRole('textbox', { name: 'Session message draft' })
      .inputValue()) === 'Mobile draft survives review',
    'Mobile draft lost'
  );
  assert(h.errors.length === 0, h.errors.join('; '));
  console.log(
    JSON.stringify({
      pass: true,
      checks: [
        'fresh mobile unified',
        'dismiss navigation',
        'file navigation',
        'ask about a deep line',
        'draft preservation',
      ],
    })
  );
} finally {
  await h.context.close();
}
process.exit(0);
