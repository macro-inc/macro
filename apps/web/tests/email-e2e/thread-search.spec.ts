// Opening a thread from a search result. The stack runs no search service, so
// the page's search request is answered here with one thread and two hits.

import type { Page } from '@playwright/test';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  deliverThread,
  messageCard,
  type ThreadMessage,
  threadMessages,
} from './harness/thread';
import { did, saw } from './ledger/record';

const THIRD = 'Step 3: the zeppelin is booked for the whole week.';
const TENTH = 'Step 10: zeppelin confirmed.';

/** The message of the thread whose text is `text`. */
function withText(messages: ThreadMessage[], text: string): ThreadMessage {
  const found = messages.find((message) => message.snippet === text);
  if (!found) throw new Error(`no message reads "${text}"`);
  return found;
}

/**
 * A ten-message thread whose 3rd and 10th messages hold the search word, and
 * the search page listing it for that word. The 3rd message's hit is the
 * longer one, which makes it the row's own snippet.
 */
async function searchFindsThread(
  page: Page,
  mailbox: Mailbox
): Promise<{ threadId: string; messages: ThreadMessage[] }> {
  const bodies = Array.from({ length: 10 }, (_, index) => ({
    text:
      index === 2
        ? THIRD
        : index === 9
          ? TENTH
          : `Step ${index + 1}: nothing to add.`,
  }));
  const thread = await deliverThread(mailbox, 'Travel plan', bodies);
  // Read before it is searched: the thread view opens unread messages
  // expanded, and these tests tell the message a result opens by which one
  // is expanded.
  const seen = await mailbox.api(`/email/email/threads/${thread.id}/seen`, {
    method: 'POST',
  });
  expect(seen.status).toBe(200);
  await expect
    .poll(async () =>
      (await threadMessages(mailbox, thread.id)).every(
        (message) => message.is_read
      )
    )
    .toBe(true);
  const messages = await threadMessages(mailbox, thread.id);
  const now = Date.now();
  // By its text: a provider that stamps mail to the second (Outlook) does
  // not keep the order of messages that arrive together.
  const hit = (text: string) => ({
    message_id: withText(messages, text).db_id,
    highlight: {
      content: [text.replace('zeppelin', '<macro_em>zeppelin</macro_em>')],
    },
    pretty_sender: 'Grace',
    sender: 'grace@example.com',
    sent_at: now,
    bcc: [],
    cc: [],
    labels: [],
    recipients: [mailbox.user.email],
  });
  await page.route(/\/dss\/search(\?|$)/, (route) =>
    route.fulfill({
      json: {
        results: [
          {
            type: 'email',
            thread_id: thread.id,
            name: 'Re: Travel plan',
            owner_id: mailbox.user.macroUserId,
            link_id: mailbox.inbox.linkId,
            created_at: now,
            updated_at: now,
            viewed_at: null,
            is_read: false,
            is_important: true,
            is_draft: false,
            inbox_visible: true,
            participants: [],
            snippet: TENTH,
            properties: [],
            email_message_search_results: [hit(THIRD), hit(TENTH)],
          },
        ],
        next_cursor: null,
      },
    })
  );

  await mailbox.open('/app/search');
  await page.getByRole('textbox', { name: 'Search' }).click();
  await page.keyboard.type('zeppelin');
  await page.keyboard.press('Enter');
  await expect(page.getByText(THIRD).first()).toBeVisible();
  return { threadId: thread.id, messages };
}

for (const provider of PROVIDERS) {
  test.describe(`a thread opened from a search result in ${anInbox(provider)}`, () => {
    test.use({ provider });

    // Class search-result-opens-wrong-message: when this fails, clicking the
    // result row opens the thread at the oldest message that matched (here the
    // 3rd) instead of at the latest message, expanded, like any other row.
    test('the row opens the thread at its latest message', async ({
      page,
      mailbox,
    }) => {
      // Outlook stamps mail to the second, and the thread view does not keep
      // the order of ten messages that arrive together: which one is the
      // latest is not known there.
      test.skip(provider === 'OUTLOOK', 'needs messages in a known order');
      const { threadId, messages } = await searchFindsThread(page, mailbox);
      await page.getByText('Travel plan').first().click();
      did('AX-056', 'F-051');

      await expect(page).toHaveURL(new RegExp(threadId));
      // Two messages that arrive within one second can swap places, so the
      // latest is the one the service lists last, never the 3rd.
      const latest = String(messages[messages.length - 1].snippet);
      expect(latest).not.toBe(THIRD);
      await expect(messageCard(page, latest).getByText('to Me')).toBeVisible();
      // The 3rd message is neither the target nor expanded.
      expect(page.url()).not.toContain(withText(messages, THIRD).db_id);
      await expect(messageCard(page, THIRD).getByText('to Me')).toHaveCount(0);
    });

    // Class search-result-opens-wrong-message: when this fails, clicking one hit
    // of the result ignores which message the hit is in, and the thread opens
    // somewhere else (at its latest message) with that message still hidden.
    test('a hit opens the thread at the message of the hit', async ({
      page,
      mailbox,
    }) => {
      const { threadId, messages } = await searchFindsThread(page, mailbox);
      await page.getByRole('button', { name: /^Show more/ }).click();
      await page.getByText(THIRD).last().click();
      did('AX-056', 'F-052');

      await expect(page).toHaveURL(new RegExp(threadId));
      await expect(page).toHaveURL(new RegExp(withText(messages, THIRD).db_id));
      await expect(messageCard(page, THIRD).getByText('to Me')).toBeVisible();
      await expect(messageCard(page, THIRD)).toBeInViewport();
      saw('STL-105', 'F-052');
    });
  });
}
