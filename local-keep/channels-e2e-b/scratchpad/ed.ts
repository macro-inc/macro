import { readFileSync, writeFileSync } from 'node:fs';
const f = 'harness/management.ts';
let t = readFileSync(f, 'utf8');
const a = "  await page.getByRole('option', { name: `Invite ${email}` }).click();\n";
if (!t.includes(a)) throw new Error('missing');
t = t.replace(a, `  // The one row reads "Invite <address>" until the device's own list of
  // people answers; if it knows the address, the row becomes that person's,
  // sometimes as it is being clicked (MEM-01). Either row invites them.
  await dialog.getByRole('option').filter({ hasText: email }).click();
`);
writeFileSync(f, t);
