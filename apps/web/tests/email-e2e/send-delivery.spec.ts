// What becomes of a send after the click: the thread marked done with it, a
// send repeated by a reload, one made offline, one the provider rejects, one
// from an alias and a reply on a thread someone else shared. The same on a
// Gmail and an Outlook inbox (an alias is a Gmail thing).

import {
  body,
  composeNew,
  graphqlOperation,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { header } from './harness/provider';
import {
  injectFault,
  notice,
  onlySentRaw,
  replyEditor,
  sentMessages,
  threadMessages,
} from './harness/send';
import type { Provider } from './harness/stack';
import { messageCard } from './harness/thread';
import { confirmed, did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/** Grace's "Lunch?" in the inbox, synced. */
async function lunch(mailbox: Mailbox): Promise<{ id: string }> {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Lunch?',
    text: 'Noon at the usual place?',
  });
  return mailbox.synced('Lunch?');
}

/** The subjects of what the mailbox holds in Sent at the provider. */
async function sentSubjects(mailbox: Mailbox): Promise<string[]> {
  return (await sentMessages(mailbox)).map((message) => message.subject);
}

for (const provider of PROVIDERS) {
  test.describe(`what becomes of a send from ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Send and mark done sends the reply but leaves its
    // thread in the inbox, does not move on to the next thread, or archives
    // the thread without sending.
    test('send and mark done sends the reply, takes the thread out of the inbox and opens the next one', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Bob <bob@example.com>',
        subject: 'Other',
        text: 'Another one.',
      });
      const other = await mailbox.synced('Other');
      const thread = await lunch(mailbox);

      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');
      await page.keyboard.press('Shift+ControlOrMeta+Enter');
      did('AC-092');

      await expect(page.getByText('Email sent', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page).toHaveURL(new RegExp(`/app/mail/${other.id}`));
      await expect(page.getByText('Another one.')).toBeVisible();
      await expect(page.getByText('Noon at the usual place?')).toHaveCount(0);
      saw('STC-975');

      await expect.poll(() => sentSubjects(mailbox)).toEqual(['Re: Lunch?']);
      await expect
        .poll(async () =>
          (await mailbox.providerMessages())
            .filter((message) => message.from.includes('@example.com'))
            .filter((message) => message.subject !== 'Re: Lunch?')
            .map((message) => `${message.subject}:${message.inInbox}`)
            .sort()
        )
        .toEqual(['Lunch?:false', 'Other:true']);
      confirmed('F-133');
    });

    // When this fails, a send whose answer never reached the browser is
    // submitted a second time when the page is reloaded and the send is
    // retried (the browser must ask what became of it first), goes out
    // twice, or is left hanging as a pending send.
    test('a send whose answer was lost is retried after a reload and reaches the provider once', async ({
      page,
      mailbox,
    }) => {
      const thread = await lunch(mailbox);
      // The service receives the first send; its answer never arrives, and
      // until the reload neither does the answer to what became of it: the
      // send is still unsettled when the page is reloaded.
      let sends = 0;
      let checks = 0;
      let reloaded = false;
      await page.route(/\/graphql$/, async (route) => {
        const operation = graphqlOperation(route.request());
        if (operation === 'EmailSendAttempt') {
          if (!reloaded) return route.abort();
          checks += 1;
          return route.fallback();
        }
        if (operation !== 'SendEmailMessage') return route.fallback();
        sends += 1;
        if (sends > 1) return route.fallback();
        await route.fetch();
        await route.abort();
      });
      const queued = page.getByLabel('Queued email sends');

      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect.poll(() => sentSubjects(mailbox)).toEqual(['Re: Lunch?']);
      await expect(queued).toBeVisible({ timeout: 30_000 });
      reloaded = true;
      await page.reload();
      did('AC-501');

      // The retry asks what became of the send it never heard back about.
      await expect.poll(() => checks, { timeout: 30_000 }).toBeGreaterThan(0);

      // One sent reply in the thread (each has its own quoted text to show).
      await expect(
        page.getByRole('button', { name: 'Show quoted text', exact: true })
      ).toHaveCount(1);
      await expect(
        page.getByRole('paragraph').filter({ hasText: 'Works for me.' }).last()
      ).toBeVisible();
      await expect(queued).toHaveCount(0);
      saw('STC-976');

      // Still one after the service has had time to act on the repeat: the
      // mail that arrives next is synced after it.
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Later',
        text: 'About later.',
      });
      await mailbox.synced('Later');
      await mailbox.stack.runScheduledSweep();
      expect(sends).toBe(1);
      expect(await sentSubjects(mailbox)).toEqual(['Re: Lunch?']);
      const messages = await threadMessages(mailbox, thread.id);
      expect(messages.map((message) => message.is_draft)).toEqual([
        false,
        false,
      ]);
      confirmed('F-137');
    });

    // When this fails, a reply that was sent is offered again as a draft
    // after a reload: the page was reloaded before it heard that the send
    // arrived, and the composer reopens with the sent text and a Send button
    // that answers "This draft session is no longer active".
    test('known bug: sent-reply-reopens-as-draft-after-reload: a reply sent before a reload is not offered again in the composer @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      const thread = await lunch(mailbox);
      // The service receives the send; its answer never arrives, and until
      // the reload neither does the answer to what became of it.
      let reloaded = false;
      let checks = 0;
      await page.route(/\/graphql$/, async (route) => {
        const operation = graphqlOperation(route.request());
        if (operation === 'SendEmailMessage') {
          await route.fetch();
          return route.abort();
        }
        if (operation !== 'EmailSendAttempt') return route.fallback();
        if (!reloaded) return route.abort();
        checks += 1;
        return route.fallback();
      });

      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect.poll(() => sentSubjects(mailbox)).toEqual(['Re: Lunch?']);
      reloaded = true;
      await page.reload();

      await expect.poll(() => checks, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(
        page.getByRole('button', { name: 'Show quoted text', exact: true })
      ).toHaveCount(1);
      await expect(page.getByText('Reply...')).toBeVisible();
      await expect(replyEditor(page)).toHaveCount(0);
    });

    // When this fails, a reply sent with no network is lost, is reported as
    // sent while nothing left the device, or never goes out once the network
    // is back.
    test('a reply sent offline waits on the device and is delivered on reconnect', async ({
      page,
      mailbox,
    }) => {
      const thread = await lunch(mailbox);
      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');

      await page.context().setOffline(true);
      await page.getByRole('button', { name: 'Send email' }).click();
      const queued = notice(page, 'Email queued to send');
      await expect(queued).toBeVisible();
      await expect(queued.getByRole('button', { name: 'Undo' })).toBeVisible();
      saw('STC-402');
      await expect(page.getByText('Email sent', { exact: true })).toHaveCount(
        0
      );
      expect(await sentSubjects(mailbox)).toEqual([]);

      await page.context().setOffline(false);
      did('AC-500');
      await expect(page.getByText('Email sent', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const raw = await onlySentRaw(mailbox);
      expect(header(raw, 'Subject')).toBe('Re: Lunch?');
      expect(raw).toContain('Works for me.');
      confirmed('F-139');
    });

    // When this fails, a send the mail provider rejected is reported as
    // sent, or its message is shown in the thread as a sent one.
    test('a send the provider rejects is reported and its message is kept as not sent', async ({
      page,
      mailbox,
    }) => {
      const thread = await lunch(mailbox);
      await injectFault(mailbox, {
        route: 'messages.send',
        error: 'forbidden',
        times: 1,
      });

      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await replyEditor(page).pressSequentially('Works for me.');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-914');

      await expect(page.getByText('Email failed to send')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText('Email sent', { exact: true })).toHaveCount(
        0
      );
      await expect(
        page.getByText(
          'Send failed before delivery. Cancel to recover this draft.'
        )
      ).toBeVisible();
      saw('STC-977');

      // The service keeps the reply as a failed send, and nothing was sent.
      // Gmail's send fails as a whole; Outlook's is an operation on the
      // mailbox that failed as rejected.
      await expect
        .poll(async () => {
          const reply = (await threadMessages(mailbox, thread.id)).find(
            (message) => message.subject === 'Re: Lunch?'
          );
          const operation = reply?.operation_status as
            | { state: string; issue: string }
            | undefined;
          return provider === 'GMAIL'
            ? reply?.scheduled_send_status
            : `${operation?.state} ${operation?.issue}`;
        })
        .toBe(provider === 'GMAIL' ? 'failed' : 'FAILED SEND_REJECTED');
      expect(await sentSubjects(mailbox)).toEqual([]);
      confirmed('F-140');
      if (provider !== 'OUTLOOK') return;

      // Outlook says why in the thread and offers to send again.
      await expect(
        page.getByText(
          'Your mail provider rejected this send. You can retry after correcting the problem in your mailbox.'
        )
      ).toBeVisible();
      saw('STL-086', 'F-140');
      await expect(
        page.getByRole('button', { name: 'Retry send' })
      ).toBeVisible();
      saw('STL-083', 'F-140');
    });

    // When this fails, a thread shared with edit access cannot be replied
    // to, or the reply is not sent from the replier's own mailbox.
    test('a reply on a thread someone else shared is sent from the own mailbox and shows in the thread', async ({
      page,
      mailbox,
    }) => {
      const bob = await mailbox.stack.user('bob@example.com');
      await mailbox.stack.link(bob, provider);
      await mailbox.stack.deliver('bob@example.com', {
        from: 'Hugo <hugo@example.com>',
        subject: 'Budget',
        text: 'About Budget.',
      });
      let theirs: { id: string }[] = [];
      await expect
        .poll(
          async () => {
            theirs = await mailbox.stack.sql<{ id: string }>(
              `SELECT t.id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE l.email_address = 'bob@example.com'`
            );
            return theirs.length;
          },
          { timeout: 60_000 }
        )
        .toBe(1);
      const budget = theirs[0].id;
      // The grant the Share dialog leaves, written directly: sharing with a
      // person goes through services this stack does not run.
      await mailbox.stack.sql(
        `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ('${budget}'::uuid, 'email_thread', '${mailbox.user.macroUserId}', 'user', 'edit') RETURNING entity_id`
      );

      await mailbox.open(`/app/mail/${budget}`);
      await expect(page.getByText('About Budget.')).toBeVisible();
      await page.getByText('Reply...').click();
      did('AL-901');
      await replyEditor(page).pressSequentially('Approved from my side.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(page.getByText('Email sent', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      // The reply is a message of the thread, no longer text in the composer.
      await expect(replyEditor(page)).toHaveCount(0);
      await expect(
        messageCard(page, 'Approved from my side.').last()
      ).toBeVisible();
      await expect(messageCard(page, 'About Budget.').first()).toBeVisible();
      saw('STL-940');

      const raw = await onlySentRaw(mailbox);
      expect(header(raw, 'Subject')).toBe('Re: Budget');
      expect(header(raw, 'From')).toContain(mailbox.inbox.email);
      expect(header(raw, 'To')).toContain('hugo@example.com');
      expect(raw).toContain('Approved from my side.');
      confirmed('F-141');
    });
  });
}

test.describe('a send an Outlook mailbox rejected', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Retry send on a reply the provider rejected once does
  // not send it: the reply ends as a draft conflict ("This draft changed in
  // your mailbox. Choose which version to keep.") and nothing goes out.
  test('known bug: outlook-retry-send-after-rejection-conflicts: Retry send delivers the rejected reply once @known-bug', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    const thread = await lunch(mailbox);
    await injectFault(mailbox, {
      route: 'messages.send',
      error: 'forbidden',
      times: 1,
    });
    await mailbox.open(`/app/mail/${thread.id}`);
    await page.getByText('Reply...').click();
    await replyEditor(page).pressSequentially('Works for me.');
    await page.getByRole('button', { name: 'Send email' }).click();
    const retry = page.getByRole('button', { name: 'Retry send' });
    await retry.click();
    did('AL-190', 'F-140');
    await expect(retry).toHaveCount(0);
    // The retry is due at once; the scheduler's sweep delivers it.
    await mailbox.stack.runScheduledSweep();
    await expect
      .poll(() => sentSubjects(mailbox), { timeout: 30_000 })
      .toEqual(['Re: Lunch?']);
    await expect(
      page.getByText('This draft changed in your mailbox.')
    ).toHaveCount(0);
  });
});

test.describe('a Gmail inbox with a send-as alias', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the alias is not offered as a From address, the
  // composer does not show it once chosen, or the message goes out from the
  // inbox's main address instead.
  test('a message sent from the alias reaches the provider with the alias as From', async ({
    page,
    mailbox,
  }) => {
    const created = await fetch(
      `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'work@example.com',
          send_as: [{ email: 'sales@example.com' }],
        }),
      }
    );
    expect(created.ok).toBe(true);
    const work = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'work@example.com'
    );
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Quarterly numbers',
      body: 'Numbers are in.',
    });
    const original = await routeDraftId(page);

    await page.getByText('ada@example.com').last().click();
    await page
      .getByRole('menuitem')
      .filter({ hasText: 'sales@example.com' })
      .click();
    did('AC-313', 'F-138');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'From address' })
    ).toContainText('sales@example.com');
    saw('STC-939');
    // The draft moves to the inbox the alias belongs to.
    await expect
      .poll(() =>
        new URL(page.url()).searchParams.get('s0.email-compose.draft')
      )
      .not.toBe(original);
    await routeDraftId(page);
    await expect(body(page)).toHaveText('Numbers are in.');
    await page.getByRole('button', { name: 'Send email' }).click();

    const raw = await onlySentRaw(mailbox, work);
    expect(header(raw, 'From')).toContain('sales@example.com');
    expect(header(raw, 'From')).not.toContain('work@example.com');
    expect(header(raw, 'Subject')).toBe('Quarterly numbers');
    confirmed('F-138');
  });
});
