import { readFileSync, writeFileSync } from 'node:fs';
const f = 'harness/management.ts';
const t = readFileSync(f, 'utf8');
const a = `  await page.getByRole('button', { name: 'Channel actions' }).click();
  await channelAction(page, name).click();
}`;
if (!t.includes(a)) throw new Error('missing');
writeFileSync(f, t.replace(a, `  // The menu can still be open, or closing, from the choice before: its
  // button would then close it under the click.
  const menu = page.getByRole('menu', { name: 'Channel actions' });
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await page.getByRole('button', { name: 'Channel actions' }).click();
    }
    await channelAction(page, name).click({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}`));
