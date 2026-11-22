// What a thread hands to the rest of Macro, on the local stack: a task that
// keeps the thread as its source, and a conversation with the assistant that
// starts with the thread attached, drafts an email the user sends from its
// card, and shows what the assistant did in the mailbox. The assistant's
// model is a scripted stand-in: no model is called.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import {
  modelRequests,
  scriptMarker,
  scriptModel,
  scriptName,
} from './harness/model';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

/** The property of a task that names what it was made from. */
const SOURCE_PROPERTY = '00000001-0000-0000-0000-00000000000b';

/** A thread of the mailbox, open. */
async function openThread(page: Page, mailbox: Mailbox) {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Lunch?',
    text: 'Noon?',
  });
  const thread = await mailbox.synced('Lunch?');
  await mailbox.open(`/app/mail/${thread.id}`);
  await expect(page.getByText('Noon?')).toBeVisible();
  return thread;
}

/**
 * Asks the assistant about the open thread. The model is the stack's
 * stand-in (`harness/model.ts`): the message names the script that answers.
 */
async function askMacro(page: Page, message: string) {
  await page.getByRole('button', { name: 'Ask Macro' }).click();
  const composer = page.getByRole('textbox', { name: 'Message the agent' });
  await expect(composer.getByRole('link', { name: 'Lunch?' })).toBeVisible();
  await composer.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(` ${message}`);
  await page.keyboard.press('Enter');
}

/** What the user's tasks of this name were made from, as the services keep it. */
function taskSources(mailbox: Mailbox, name: string) {
  return mailbox.stack.sql<{ source: unknown }>(
    `SELECT p.values -> 'value' AS source
       FROM "Document" d
       JOIN entity_properties p
         ON p.entity_id = d.id AND p.entity_type = 'TASK'
        AND p.property_definition_id = '${SOURCE_PROPERTY}'
      WHERE d.owner = '${mailbox.user.macroUserId}' AND d.name = '${name}'`
  );
}

for (const provider of PROVIDERS) {
  test.describe(`a thread of ${anInbox(provider)} handed to the rest of Macro`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, "Create task" on a thread makes no task, or one that
    // has lost the thread: the task does not lead back to the email it is
    // about.
    test('a task created from a thread keeps the thread as its source', async ({
      page,
      mailbox,
    }) => {
      const thread = await openThread(page, mailbox);

      await page.getByRole('button', { name: 'Create task' }).click();
      did('AL-130');
      const composer = page.getByRole('dialog');
      await expect(
        composer.getByRole('button', { name: 'Open source Lunch?' })
      ).toBeVisible();
      await expect(
        composer
          .getByRole('textbox', { name: 'Add description...' })
          .getByRole('link', { name: 'Lunch?' })
      ).toBeVisible();
      saw('STL-945');

      await composer.getByRole('textbox', { name: 'Title' }).click();
      await page.keyboard.type('Answer Grace');
      await composer.getByRole('button', { name: 'Create Task' }).click();
      await expect(composer).toBeHidden();

      await expect
        .poll(() => taskSources(mailbox, 'Answer Grace'), { timeout: 30_000 })
        .toEqual([
          { source: [{ entity_id: thread.id, entity_type: 'THREAD' }] },
        ]);
      confirmed('F-167');
    });

    // When this fails, "Ask Macro" on a thread opens no conversation with
    // the assistant, or one that does not carry the thread: the user would
    // have to find and attach the email themselves.
    test('Ask Macro opens a conversation with the thread attached', async ({
      page,
      mailbox,
    }) => {
      await openThread(page, mailbox);

      await page.getByRole('button', { name: 'Ask Macro' }).click();
      did('AL-129');
      await expect(
        page
          .getByRole('textbox', { name: 'Message the agent' })
          .getByRole('link', { name: 'Lunch?' })
      ).toBeVisible();
      saw('STL-945');
    });

    // When this fails, an email the assistant drafted cannot be changed or
    // sent from its card: the card does not appear, an edit is lost, or
    // "Send email" sends nothing from the user's mailbox.
    test('a draft of the assistant is edited and sent from its card', async ({
      page,
      mailbox,
    }) => {
      const script = scriptName('draft-email');
      const linus = mailbox.stack.address('linus@example.com');
      await scriptModel(script, {
        replies: [
          {
            calls: [
              {
                name: 'mcp__macro_internal__PresentReview',
                args: {
                  acting_as: 'requester',
                  kind: 'email',
                  title: 'Lunch with Linus',
                  drafts: [
                    {
                      subject: 'Lunch on Friday',
                      body: 'Are you free at noon?',
                      to: [{ email: linus }],
                    },
                  ],
                },
              },
            ],
          },
          { text: 'The draft is on the card.' },
        ],
      });
      await openThread(page, mailbox);
      await askMacro(page, `${scriptMarker(script)} draft an email to Linus`);

      const card = page.getByRole('region', { name: 'Lunch with Linus' });
      await expect(card.getByText(linus)).toBeVisible();
      await expect(card.getByText('Are you free at noon?')).toBeVisible();
      const subject = card.getByRole('textbox', { name: 'Subject' });
      await expect(subject).toHaveValue('Lunch on Friday');
      // The model was asked once for the draft and once after the card.
      await expect(page.getByText('The draft is on the card.')).toBeVisible();

      await subject.fill('Lunch on Thursday');
      did('AX-052');
      await card.getByRole('button', { name: 'Send email' }).click();
      did('AX-054');
      await expect(card.getByRole('status')).toHaveText('Sent', {
        timeout: 60_000,
      });
      // The field shows what was typed whether or not the card took the edit:
      // only the sent message says that the edit of the subject was kept.
      await expect
        .poll(
          async () =>
            (await mailbox.providerMessages()).map(
              (message) => message.subject
            ),
          { timeout: 60_000 }
        )
        .toContain('Lunch on Thursday');
      confirmed('F-168');

      await expect(subject).toBeDisabled();
      await expect(subject).toHaveValue('Lunch on Thursday');
      saw('STX-976');
    });

    // When this fails, the conversation does not show what the assistant
    // did in the user's mail: the steps of a turn that listed inboxes and
    // labels, read a thread and archived it are missing or misnamed.
    test('the steps of a turn name what the assistant read, listed and changed in mail', async ({
      page,
      mailbox,
    }) => {
      const script = scriptName('read-mail');
      const thread = await openThread(page, mailbox);
      await scriptModel(script, {
        // The turn's id, which a program must carry, is in the prompt.
        captures: { turn: '<invocation turn_id=\\\\?"([0-9a-f-]+)' },
        replies: [
          {
            calls: [
              {
                name: 'mcp__macro_internal__ExecuteCode',
                args: {
                  acting_as: 'requester',
                  turn_id: '{{turn}}',
                  source: [
                    'export async function main({macro}) {',
                    '  const inboxes = await macro.email.links();',
                    '  const labels = await macro.email.labels();',
                    `  const thread = macro.email.byId('${thread.id}');`,
                    '  const messages = await thread.messages();',
                    '  await thread.archive();',
                    '  return {data: {inboxes: inboxes.length, labels: labels.length, messages: messages.length}};',
                    '}',
                  ].join('\n'),
                },
              },
            ],
          },
          { text: 'I archived the thread.' },
        ],
      });
      await askMacro(page, `${scriptMarker(script)} archive this`);
      await expect(page.getByText('I archived the thread.')).toBeVisible({
        timeout: 60_000,
      });

      const session = page.getByRole('region', { name: 'Agent session' });
      await session.getByRole('button', { name: 'Used 4 tools' }).click();
      did('AX-326');
      const steps = session.getByRole('region', { name: 'Tool calls' });
      for (const step of [
        'List Links',
        'List Labels',
        'Get Thread Messages',
        'Archive Thread',
      ]) {
        await expect(
          steps.getByText(step, { exact: true }).first()
        ).toBeVisible();
      }
      saw('STX-975');

      // The program ran with what the model was sent back, and the change
      // the steps name reached the provider.
      const results = (await modelRequests(script)).at(-1)?.body;
      expect(JSON.stringify(results)).toContain('"data":{"inboxes":1,');
      await expect
        .poll(
          async () =>
            (await mailbox.providerMessages()).find(
              (message) => message.subject === 'Lunch?'
            )?.inInbox,
          { timeout: 60_000 }
        )
        .toBe(false);
      confirmed('F-190');
    });
  });
}
