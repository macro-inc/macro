// The team's CRM on the local stack: a contact's record shows the mail a
// member exchanged with them and starts a message to them, and a domain a
// member excludes stops that mail from being shared with the team.
//
// A test's user owns a team of its own, shares its mailbox with the team's
// CRM, and has one contact, at a company domain no other test writes to.

import type { Page } from '@playwright/test';
import { body, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { readMailbox } from './harness/journeys';
import { createTeam } from './harness/local-stack';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const JSON_BODY = { 'content-type': 'application/json' };

type Privacy = {
  enabled: boolean;
  team_domains: string[];
  personal_domains: string[];
};

/** Asks the CRM, in the document storage service, as the signed-in user. */
async function crm<T>(
  mailbox: Mailbox,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const answer = await mailbox.api(`/dss/crm${path}`, {
    method: init.method,
    headers: JSON_BODY,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!answer.ok) {
    throw new Error(
      `the CRM answered ${path} with ${answer.status}:\n${await answer.text()}`
    );
  }
  return (await answer.json()) as T;
}

/**
 * The domain of a company only this test knows. The test's own mailboxes are
 * at a `.test` domain, which the CRM never takes for a company.
 */
function companyDomain(mailbox: Mailbox): string {
  const own = mailbox.stack.address('grace@example.com').split('@')[1];
  return `${own.split('.')[0]}.example.com`;
}
/**
 * The user's team, their mailbox shared with its CRM, and Grace, at a company
 * of her own, as a contact of the team.
 */
async function teamWithContact(mailbox: Mailbox) {
  const team = await createTeam(mailbox.user, 'Analytical Engines');
  const shared = await crm<Privacy>(mailbox, '/email-privacy', {
    method: 'PUT',
    body: {
      action: 'set_consent',
      enabled: true,
      link_id: mailbox.inbox.linkId,
    },
  });
  expect(shared.enabled).toBe(true);
  const domain = companyDomain(mailbox);
  const grace = `grace@${domain}`;
  const contact = await crm<{ id: string }>(mailbox, '/contacts', {
    method: 'POST',
    body: { name: 'Grace', email: grace },
  });
  return { team, domain, grace, contact };
}

/** The Emails section of the contact's record. */
async function openEmails(page: Page, mailbox: Mailbox, contactId: string) {
  await mailbox.open(`/app/companies/contact/${contactId}/emails`);
  return page.getByRole('region', { name: 'Emails' });
}

/** The CRM's page of Settings, with the lists of excluded domains. */
async function openPrivacy(page: Page, mailbox: Mailbox) {
  await mailbox.open('/app/mail/~/settings/crm');
  await expect(page.getByText('Team blacklist')).toBeVisible();
}

for (const provider of PROVIDERS) {
  test.describe(`the team's CRM and ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // New email sends to the contact and lists the sent message on its
    // record. Mail sync must also preserve that contact's identity.
    test('New email reuses the manual contact and shows the sent mail', async ({
      page,
      mailbox,
    }) => {
      const { team, grace, contact } = await teamWithContact(mailbox);
      const emails = await openEmails(page, mailbox, contact.id);
      await expect(
        emails.getByText('No emails with this contact yet.')
      ).toBeVisible();
      saw('STX-315');

      await emails.getByRole('button', { name: 'New email' }).click();
      did('AX-060');
      // The composer cuts a long address short; the provider has it whole.
      await expect(
        page.getByRole('link', { name: grace.split('.')[0] })
      ).toBeVisible();
      await page.getByPlaceholder(/subject/i).fill('Next steps');
      await body(page).click();
      await page.keyboard.type('Shall we meet on Tuesday?');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(notice(page, 'Email sent')).toBeVisible();

      const sent = async () =>
        (await readMailbox(mailbox, mailbox.inbox.email)).filter(
          (message) => message.subject === 'Next steps'
        );
      await expect
        .poll(async () => (await sent()).length, {
          message: 'the provider never received "Next steps"',
          timeout: 30_000,
        })
        .toBe(1);
      expect((await sent())[0].to).toEqual([grace]);

      // Wait for the persisted source independently of which contact was
      // chosen, so the next assertion detects a duplicate as soon as it exists.
      const sources = () =>
        mailbox.stack.sql<{ contact_id: string }>(
          `SELECT s.contact_id FROM crm_contact_sources s
           JOIN crm_contact_emails e ON e.contact_id = s.contact_id
           WHERE s.link_id = '${mailbox.inbox.linkId}' AND e.email = '${grace}'`
        );
      await expect
        .poll(sources, {
          message: 'the sent mail never reached the CRM',
          timeout: 60_000,
        })
        .not.toHaveLength(0);
      const records = await mailbox.stack.sql(
        `SELECT c.id, c.company_id FROM crm_contacts c
         JOIN crm_contact_emails e ON e.contact_id = c.id
         WHERE c.team_id = '${team.id}' AND e.email = '${grace}'`
      );
      expect(records).toEqual([{ id: contact.id, company_id: null }]);
      expect(await sources()).toEqual([{ contact_id: contact.id }]);

      // The sent message is mail with the contact: the record lists it, for
      // the team and for the member whose inbox holds it.
      await mailbox.synced('Next steps');
      const listed = await openEmails(page, mailbox, contact.id);
      await expect(
        listed.getByText('Next steps', { exact: true })
      ).toBeVisible();
      saw('STX-970');
      await listed
        .getByRole('radiogroup', { name: 'Email inboxes' })
        .getByText('Me', { exact: true })
        .click();
      did('AX-321');
      await expect(listed.getByRole('radio', { name: 'Me' })).toBeChecked();
      await expect(
        listed.getByText('Next steps', { exact: true })
      ).toBeVisible();
      await listed
        .getByRole('radiogroup', { name: 'Email importance' })
        .getByText('Signal', { exact: true })
        .click();
      did('AX-320');
      await expect(listed.getByRole('radio', { name: 'Signal' })).toBeChecked();
      await expect(
        listed.getByText('Next steps', { exact: true })
      ).toBeVisible();
      confirmed('F-165');
    });

    // When this fails, a domain a member excludes is not kept, or mail with
    // that domain is still shared with the team's CRM.
    test('an excluded domain keeps its mail out of the CRM', async ({
      page,
      mailbox,
    }) => {
      const { team, domain, grace, contact } = await teamWithContact(mailbox);
      await mailbox.deliver({
        from: `Grace <${grace}>`,
        subject: 'Quarterly plan',
        text: 'About the quarter.',
      });
      await mailbox.synced('Quarterly plan');
      const plan = async () =>
        (await openEmails(page, mailbox, contact.id)).getByText(
          'Quarterly plan',
          { exact: true }
        );
      const none = async () =>
        (await openEmails(page, mailbox, contact.id)).getByText(
          'No emails with this contact yet.'
        );
      const teamList = () =>
        mailbox.stack.sql(
          `SELECT domain FROM crm_blocked_domains WHERE team_id = '${team.id}'`
        );
      const ownList = () =>
        mailbox.stack.sql(
          `SELECT domain FROM crm_personal_email_blocklist WHERE team_id = '${team.id}'`
        );
      await expect(await plan()).toBeVisible();

      // For the whole team.
      await openPrivacy(page, mailbox);
      await page.getByLabel('Domain to block for the team').fill(domain);
      await page.getByLabel('Domain to block for the team').press('Enter');
      did('AX-322');
      const remove = page.getByRole('button', { name: `Remove ${domain}` });
      await expect(remove).toBeVisible();
      saw('STX-950');
      expect(await teamList()).toEqual([{ domain }]);
      expect(
        (await crm<Privacy>(mailbox, '/email-privacy')).team_domains
      ).toEqual([domain]);
      await expect(await none()).toBeVisible();

      // Taken back, the mail is shared again.
      await openPrivacy(page, mailbox);
      await remove.click();
      await expect(remove).toHaveCount(0);
      expect(await teamList()).toEqual([]);
      await expect(await plan()).toBeVisible();

      // For the member's own mailbox only.
      await openPrivacy(page, mailbox);
      await page.getByLabel('Domain to block for my emails').fill(domain);
      await page.getByLabel('Domain to block for my emails').press('Enter');
      await expect(remove).toBeVisible();
      expect(await ownList()).toEqual([{ domain }]);
      expect(await teamList()).toEqual([]);
      await expect(await none()).toBeVisible();
      confirmed('F-192');
    });
  });
}
