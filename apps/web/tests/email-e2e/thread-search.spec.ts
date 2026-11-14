// Opening a thread from a search result. The stack runs no search service, so
// the page's search request is answered here with one thread and two hits.

import type { Page } from '@playwright/test';
import { expect, type Mailbox, test } from './harness/fixtures';
import {
  deliverThread,
  messageCard,
  type ThreadMessage,
  threadMessages,
} from './harness/thread';

const THIRD = 'Step 3: the zeppelin is booked for the whole week.';
const TENTH = 'Step 10: zeppelin confirmed.';

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
  const messages = await threadMessages(mailbox, thread.id);
  const now = Date.now();
  const hit = (index: number, text: string) => ({
    message_id: messages[index].db_id,
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
            email_message_search_results: [hit(2, THIRD), hit(9, TENTH)],
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

test.describe('a thread opened from a search result', () => {
  // Class search-result-opens-wrong-message: when this fails, clicking the
  // result row opens the thread at the oldest message that matched (here the
  // 3rd) instead of at the latest message, expanded, like any other row.
  test('the row opens the thread at its latest message', async ({
    page,
    mailbox,
  }) => {
    const { threadId, messages } = await searchFindsThread(page, mailbox);
    await page.getByText('Travel plan').first().click();

    await expect(page).toHaveURL(new RegExp(threadId));
    await expect(messageCard(page, TENTH).getByText('to Me')).toBeVisible();
    // The 3rd message is neither the target nor expanded.
    expect(page.url()).not.toContain(messages[2].db_id);
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

    await expect(page).toHaveURL(new RegExp(threadId));
    await expect(page).toHaveURL(new RegExp(messages[2].db_id));
    await expect(messageCard(page, THIRD).getByText('to Me')).toBeVisible();
  });
});
