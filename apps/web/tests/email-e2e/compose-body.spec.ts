// What the body of a message carries: formatting from the keyboard and from
// the format ribbon, a person mentioned in a reply, the quoted original shown
// or left out, and the Macro watermark of an account without a paid plan.
// The same for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { body, composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { type ReadMessage, readMailbox } from './harness/journeys';
import {
  notice,
  occurrences,
  replyEditor,
  threadMessages,
} from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const XAVIER = 'xavier@example.com';
const BOB = 'bob@example.com';
const QUESTION = 'Which dates work?';

/** A message from Xavier, opened in its thread; answers the thread's id. */
async function openOffsite(page: Page, mailbox: Mailbox): Promise<string> {
  await mailbox.deliver({
    from: `Xavier <${XAVIER}>`,
    to: mailbox.inbox.email,
    subject: 'Offsite',
    text: QUESTION,
  });
  const thread = await mailbox.synced('Offsite');
  await mailbox.open(`/app/mail/${thread.id}`);
  did('AL-910');
  await expect(page.getByText(QUESTION).first()).toBeVisible();
  return thread.id;
}

/** Presses one of the message's own buttons, which show while it is hovered. */
async function pressMessageButton(
  page: Page,
  name: 'Reply' | 'Forward'
): Promise<void> {
  await page.getByText(QUESTION).first().hover();
  await page.getByRole('button', { name, exact: true }).click();
}

/** The one message the inbox sent with this subject, as the provider holds it. */
async function sentCopy(
  mailbox: Mailbox,
  subject: string
): Promise<ReadMessage> {
  const sent = async () =>
    (await readMailbox(mailbox, mailbox.inbox.email)).filter(
      (message) =>
        message.subject === subject && message.from === mailbox.inbox.email
    );
  await expect
    .poll(async () => (await sent()).length, {
      message: `the provider never received "${subject}"`,
      timeout: 30_000,
    })
    .toBe(1);
  return (await sent())[0];
}

/** Whether `html` holds `text` as the first text inside a `tag` element. */
function inside(html: string, tag: string, text: string): boolean {
  return new RegExp(`<${tag}\\b[^>]*>(?:\\s*<(?!/)[^>]*>)*${text}`).test(html);
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`the body of a message, ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a formatting shortcut does nothing in the composer, or
    // the formatting is on screen but the message goes out as plain text.
    test('formatting typed with the keyboard shortcuts is in the sent message', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: BOB,
        subject: 'Release notes',
        body: 'Run ',
      });
      const editor = body(page);

      await page.keyboard.press('ControlOrMeta+KeyE');
      did('AC-035');
      await page.keyboard.type('npm test');
      await expect(editor.locator('code')).toHaveText('npm test');
      await page.keyboard.press('ControlOrMeta+KeyE');
      await page.keyboard.type(' not ');

      await page.keyboard.press('ControlOrMeta+Shift+KeyX');
      did('AC-034');
      await page.keyboard.type('yarn');
      await expect(editor.getByText('yarn', { exact: true })).toHaveCSS(
        'text-decoration-line',
        'line-through'
      );
      await page.keyboard.press('ControlOrMeta+Shift+KeyX');
      await page.keyboard.type(' it is ');

      await page.keyboard.press('ControlOrMeta+Shift+KeyH');
      did('AC-040');
      await page.keyboard.type('vital');
      await expect(editor.locator('mark')).toHaveText('vital');
      await page.keyboard.press('ControlOrMeta+Shift+KeyH');

      await page.keyboard.press('Enter');
      await page.keyboard.press('ControlOrMeta+Shift+Digit8');
      did('AC-036');
      await page.keyboard.type('apples');
      await expect(editor.locator('ul > li')).toHaveText('apples');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      await page.keyboard.press('ControlOrMeta+Shift+Digit7');
      did('AC-037');
      await page.keyboard.type('first step');
      await expect(editor.locator('ol > li')).toHaveText('first step');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      await page.keyboard.press('ControlOrMeta+Shift+Digit9');
      did('AC-039');
      await page.keyboard.type('as they said');
      await expect(editor.locator('blockquote')).toHaveText('as they said');
      saw('STC-934');

      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();

      const { html } = await sentCopy(mailbox, 'Release notes');
      expect(inside(html, 'code', 'npm test'), html).toBe(true);
      expect(inside(html, 's', 'yarn'), html).toBe(true);
      expect(inside(html, 'mark', 'vital'), html).toBe(true);
      expect(inside(html, 'ul', 'apples'), html).toBe(true);
      expect(inside(html, 'ol', 'first step'), html).toBe(true);
      expect(inside(html, 'blockquote', 'as they said'), html).toBe(true);
      confirmed('F-103');
    });

    // When this fails, the Format button no longer opens the ribbon, or its
    // Bold, Italic or Checklist button does not format what is typed next.
    test('the format ribbon makes text bold, italic and a checklist', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: BOB,
        subject: 'Agenda',
        body: 'Plain ',
      });
      const editor = body(page);

      await page.getByRole('button', { name: 'Format', exact: true }).click();
      did('AC-031');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      did('AC-032');
      await page.keyboard.type('heavy');
      await expect(editor.locator('strong')).toHaveText('heavy');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      await page.keyboard.type(' ');

      await page.getByRole('button', { name: 'Italic', exact: true }).click();
      did('AC-033');
      await page.keyboard.type('slanted');
      await expect(editor.locator('em')).toHaveText('slanted');
      await page.getByRole('button', { name: 'Italic', exact: true }).click();

      await page.keyboard.press('Enter');
      await page
        .getByRole('button', { name: 'Checklist', exact: true })
        .click();
      did('AC-038');
      await page.keyboard.type('book the room');
      await expect(
        editor.getByRole('checkbox', { name: 'book the room' })
      ).toBeVisible();
      saw('STC-934');

      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();

      const { html } = await sentCopy(mailbox, 'Agenda');
      expect(inside(html, 'strong', 'heavy'), html).toBe(true);
      expect(inside(html, 'em', 'slanted'), html).toBe(true);
      // The checklist goes out as a list marked as one, its item inside.
      expect(html).toMatch(
        /<ul\b[^>]*\bmd-check\b[^>]*>\s*<li\b[^>]*>(?:\s*<(?!\/)[^>]*>)*book the room/
      );
      confirmed('F-103');
    });

    // When this fails, mentioning a person in a reply no longer copies them:
    // no notice, or the reply the email service holds has nobody in Cc.
    // The stack knows one person, the signed-in user, so they mention
    // themselves.
    test('a person mentioned in a reply is added to Cc', async ({
      page,
      mailbox,
    }) => {
      const threadId = await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Reply');
      did('AL-168');
      await replyEditor(page).pressSequentially('Any week in May. ');
      did('AC-081');

      await page.keyboard.type('@ada');
      await expect(page.getByText('People', { exact: true })).toBeVisible();
      await page.keyboard.press('Enter');
      did('AC-082');
      await expect(
        notice(page, `${mailbox.inbox.email} added to CC`)
      ).toBeVisible();
      saw('STC-018');
      await expect(
        replyEditor(page).getByRole('link', { name: '@ada' })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Replying to Xavier + 1' })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      await expect
        .poll(
          async () =>
            (await threadMessages(mailbox, threadId))
              .filter((message) => !message.is_draft)
              .flatMap((message) => message.cc.map((cc) => cc.email)),
          { message: 'no sent message of the thread has the person in Cc' }
        )
        .toContain(mailbox.inbox.email);
      confirmed('F-106');
    });

    // When this fails, the quoted-text button no longer puts the original in
    // the editor, or a reply whose writer deleted the quote still goes out
    // with it.
    test('a reply whose quoted original was shown and deleted goes out without it', async ({
      page,
      mailbox,
    }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Reply');
      did('AL-168');
      await replyEditor(page).pressSequentially('Any week in May.');
      did('AC-081');

      const toggle = page.getByRole('button', {
        name: 'quoted text',
        exact: true,
      });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      did('AC-090');
      await expect(replyEditor(page)).toContainText(QUESTION);
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      saw('STC-980');

      await replyEditor(page).click();
      await page.keyboard.press('ControlOrMeta+KeyA');
      await page.keyboard.type('Only this.');
      await expect(replyEditor(page)).toHaveText('Only this.');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const reply = await sentCopy(mailbox, 'Re: Offsite');
      expect(reply.html).toContain('Only this.');
      expect(reply.html).not.toContain(QUESTION);
      confirmed('F-111');
    });

    // When this fails, a forward no longer offers its folded original, the
    // button does not unfold it into the editor, or the forward goes out
    // without the original or with it twice.
    test('Show forwarded message unfolds the original, which is sent once', async ({
      page,
      mailbox,
    }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Forward');
      did('AL-170');
      const show = page.getByRole('button', {
        name: 'Show forwarded message',
        exact: true,
      });
      await expect(show).toBeVisible();
      saw('STC-095');
      await expect(replyEditor(page).getByText(QUESTION)).toBeHidden();

      await show.click();
      did('AC-089');
      await expect(replyEditor(page).getByText(QUESTION)).toBeVisible();
      saw('STC-980');

      await page.getByRole('combobox').fill(BOB);
      await page.keyboard.press('Enter');
      did('AC-003');
      await expect(page.getByRole('link', { name: BOB })).toBeVisible();
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const forward = await sentCopy(mailbox, 'Fwd: Offsite');
      expect(forward.to).toEqual([BOB]);
      expect(occurrences(forward.html, QUESTION)).toBe(1);
      confirmed('F-111');
    });

    // When this fails, an account without a paid plan no longer sees the
    // Macro watermark under its message, or pressing it does not open the
    // upgrade prompt.
    test('without a paid plan the watermark shows and opens the upgrade prompt', async ({
      page,
      mailbox,
    }) => {
      mailbox.front.stub(({ path }) => {
        if (path !== '/auth/user/legacy_user_permissions') return undefined;
        return {
          json: {
            userId: mailbox.user.macroUserId,
            email: mailbox.user.email,
            name: mailbox.user.email.split('@')[0],
            permissions: [],
            licenseStatus: 'inactive',
            tutorialComplete: true,
            group: null,
            hasChromeExt: false,
            hasTrialed: true,
            aiDataConsent: true,
            referralCode: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        };
      });
      await mailbox.open('/app/mail/new');
      did('AC-910');

      const watermark = page.getByRole('button', {
        name: '-- Sent with Macro',
      });
      await expect(watermark).toBeVisible();
      saw('STC-093');

      await watermark.click();
      did('AC-070');
      const prompt = page.getByRole('dialog');
      await expect(
        prompt.getByRole('heading', { name: 'Upgrade your plan' })
      ).toBeVisible();
      await expect(
        prompt.getByText('Upgrade to send emails without the Macro signature.')
      ).toBeVisible();
      saw('STC-981');
    });
  });
}
