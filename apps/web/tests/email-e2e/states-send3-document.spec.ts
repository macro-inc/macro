// What a reply says when a document mentioned in it could not be made
// viewable by its link.

import { loadAppSteadily, relayUploads } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice, replyEditor } from './harness/send';
import { failOperation } from './harness/states-send2';
import {
  createDocument,
  linkShare,
  makePrivate,
} from './harness/ways-compose-more';
import { replyTo } from './harness/ways-compose2';
import { saw } from './ledger/record';

test.beforeEach(async ({ page }) => {
  await loadAppSteadily(page);
  await relayUploads(page);
});

// Gmail only: who may open the document is the document service's, whatever
// the mailbox.
// When this fails, a private document mentioned with @ in a reply stays
// private without a word: the recipients get a link they cannot open and
// the writer is not told.
test('a mentioned document that could not be made viewable says so', async ({
  page,
  mailbox,
}) => {
  const documentId = await createDocument(mailbox, 'Harbour plan');
  await makePrivate(mailbox, documentId);
  await failOperation(page, 'UpdateEntitySharePolicies');
  await replyTo(page, mailbox, 'Plan');
  await replyEditor(page).click();
  await page.keyboard.type('The plan is in ');
  await page.keyboard.type('@Harbour');
  await expect(page.getByText('Harbour plan', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(
    replyEditor(page).getByRole('link', { name: /Harbour plan/ })
  ).toBeVisible();
  await expect(
    notice(page, 'Recipients may not be able to view this file')
  ).toContainText(
    'Please consult the document owner to change share permissions'
  );
  saw('STC-020', 'F-106');
  expect((await linkShare(mailbox, documentId)).linkShare).toBeFalsy();
});
