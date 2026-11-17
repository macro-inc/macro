// The way into connecting an Outlook account from Settings › Email: the
// "Connect" button of its Outlook row (aria "Connect an Outlook account"),
// for someone whose own Outlook inbox is already connected. The connection
// goes through Microsoft's consent page at the Outlook emulator; `microsoft`
// (`harness/ways-home.ts`) is the authentication service's half of it.
// Connecting a Google Workspace account from the row above is AX-001
// (`link.spec.ts`).

import { loadAppSteadily } from './harness/drafts';
import { notice } from './harness/send';
import {
  expect,
  subjectsIn,
  test,
  watchedAtProvider,
} from './harness/ways-home';
import { connectedInboxes, links, SETTINGS } from './harness/ways-settings';
import { confirmed, did, saw } from './ledger/record';

/** The account connected from Settings: nobody had connected it before. */
const WORK = 'work@example.com';

test.use({ provider: 'OUTLOOK', outlookOffered: true });

// When this fails, "Connect" on the Outlook row of Settings › Email no
// longer starts an Outlook connection (no Microsoft consent page), or the
// connection does not end with the account connected: no notice, the email
// service does not list it beside the inbox already there, Macro does not
// watch it at Microsoft, or its mail never reaches Macro.
test('Connect an Outlook account in Settings › Email connects it and its mail arrives', async ({
  page,
  mailbox,
  auth,
  microsoft,
}) => {
  await loadAppSteadily(page);
  const own = mailbox.inbox.email;
  await mailbox.stack.seed('OUTLOOK', WORK, [
    {
      from: 'Linus <linus@example.com>',
      subject: 'Budget',
      text: 'Numbers attached.',
    },
  ]);
  expect(await watchedAtProvider(mailbox, 'OUTLOOK', WORK)).toBe(false);

  await mailbox.open(SETTINGS);
  await page
    .getByRole('button', { name: 'Connect an Outlook account' })
    .click();
  did('AX-002', 'F-002');
  await page.waitForURL(/\/oauth2\/v2\.0\/authorize/);
  await page.getByRole('button', { name: new RegExp(WORK) }).click();

  await expect(notice(page, 'Account connected')).toBeVisible();
  saw('STX-020', 'F-002');
  await expect(page).toHaveURL(/\/app\/mail\/~\/settings\/email$/);
  expect({
    google: auth.starts.length,
    microsoft: microsoft.starts.length,
  }).toEqual({ google: 0, microsoft: 1 });
  await expect
    .poll(() => connectedInboxes(mailbox))
    .toEqual([own, WORK].sort());
  const [link] = (await links(mailbox)).filter(
    (each) => each.email_address === WORK
  );
  expect(link.provider).toBe('OUTLOOK');
  await expect
    .poll(() => watchedAtProvider(mailbox, 'OUTLOOK', WORK), {
      message: `Macro never watched ${WORK} at Microsoft`,
      timeout: 60_000,
    })
    .toBe(true);
  confirmed('F-002');
  await expect
    .poll(() => subjectsIn(mailbox, link.id), {
      message: `the mail of ${WORK} never reached Macro`,
      timeout: 60_000,
    })
    .toContain('Budget');
});
