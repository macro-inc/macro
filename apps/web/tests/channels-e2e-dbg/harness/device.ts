import { expect, type Page } from '@playwright/test';
import { type ChannelView, conversationRow } from './channel';
import { Conversation } from './messages';
import { goOffline } from './network';
import { findConversations } from './sidebar';

export type Named = { id: string; name: string };

/**
 * A device is a browser profile: it keeps the messages it has shown and the
 * writes it has not yet sent. These are the things a person does that depend
 * on what the device holds.
 */

/**
 * The channel as it is on the screen, one line a message, top to bottom:
 * `text`, `text [👍 2]` with reactions, `  > text` for a reply under the
 * message above. `serverChannel` writes what the services hold the same way.
 * The list draws only the rows near its window, so this is for channels short
 * enough to be drawn whole.
 */
export async function shown(view: ChannelView): Promise<string[]> {
  return view.list.locator('[data-channel-thread-row]').evaluateAll((rows) =>
    rows.flatMap((row) =>
      Array.from(row.querySelectorAll('[data-message]')).map(
        (message, index) => {
          const content =
            message.querySelector('[data-message-content]') ??
            message.querySelector('[data-message-slot="content"]');
          const text = (content?.textContent ?? '').trim();
          const reactions = Array.from(
            message.querySelectorAll('[data-message-reaction-chip]')
          )
            .map((chip) => {
              const emoji = chip.getAttribute('data-emoji') ?? '';
              const count = (chip.textContent ?? '').replace(emoji, '').trim();
              return count ? `${emoji} ${count}` : emoji;
            })
            .sort();
          const body =
            reactions.length > 0 ? `${text} [${reactions.join(' ')}]` : text;
          return index === 0 ? body : `  > ${body}`;
        }
      )
    )
  );
}

/** Asserts that the screen comes to show exactly these lines. */
export async function expectShown(
  view: ChannelView,
  lines: string[]
): Promise<void> {
  await expect
    .poll(() => shown(view), {
      message: 'the channel as it is on the screen',
      timeout: 30_000,
    })
    .toEqual(lines);
}

/**
 * Brings the channel's row into the list beside the open conversation. The
 * list is searched through the services, so this is done while connected.
 */
export async function findRow(page: Page, channel: Named): Promise<void> {
  await findConversations(page, channel.name);
  await expect(conversationRow(page, channel.name)).toBeVisible();
}

/** Opens the channel from its row in the list, without loading the page. */
export async function openFromList(
  page: Page,
  channel: Named
): Promise<Conversation> {
  await conversationRow(page, channel.name).click();
  const view = new Conversation(page, channel.id);
  await view.shown();
  return view;
}

/**
 * Leaves the channel on screen for another one and loads the page again
 * there: nothing the page had in memory is left, so what it then shows of a
 * channel it has not asked the services for comes from the device.
 */
export async function startAfresh(page: Page, elsewhere: Named): Promise<void> {
  await findRow(page, elsewhere);
  await openFromList(page, elsewhere);
  await page.reload();
  await new Conversation(page, elsewhere.id).shown();
}

/**
 * Loses the connection with the channel's row in view, so that the channel
 * can then be opened from it. A check marked as failing sometimes takes this
 * step outside the mark, so that only the opening is excused.
 */
export async function loseConnectionAt(
  page: Page,
  channel: Named
): Promise<void> {
  await findRow(page, channel);
  await goOffline(page.context());
}

/**
 * Loses the connection with the channel's row in view, then opens the
 * channel from it.
 */
export async function openOffline(
  page: Page,
  channel: Named
): Promise<Conversation> {
  await loseConnectionAt(page, channel);
  return openFromList(page, channel);
}

/** What the app shows in place of a channel it could not load. */
export function couldNotLoad(page: Page) {
  return page.getByText('Unable to load this channel');
}

/**
 * Reads the channel the way that leaves it on the device: opens it, looks at
 * another channel, and comes back to it, which is when a device brings what
 * it holds of a channel up to date.
 */
export async function readAndReturn(
  page: Page,
  channel: Named,
  elsewhere: Named
): Promise<Conversation> {
  const view = new Conversation(page, channel.id);
  await view.open();
  await findRow(page, elsewhere);
  await openFromList(page, elsewhere);
  await findRow(page, channel);
  return openFromList(page, channel);
}

/**
 * The person does nothing for a while. A device fetches channels it expects
 * to be asked for only while the app is left alone, so this wait is the
 * behaviour under test; it is the one timed wait in the suite.
 */
export async function leaveAlone(page: Page, seconds: number): Promise<void> {
  await page.waitForTimeout(seconds * 1000);
}

/**
 * The device loses the channels and waiting writes it kept: their files
 * are gone, as when the app replaces them for a new format. The page is taken off the app first, since the files of a running
 * page cannot go; the caller opens the app again.
 */
export async function loseKeptData(page: Page): Promise<void> {
  await page.route('**/kept-data-lost', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' })
  );
  await page.goto('/kept-data-lost');
  // The page just left holds its files for a moment more.
  await expect(async () => {
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      for (const name of names) {
        await root.removeEntry(name, { recursive: true });
      }
    });
  }).toPass({ timeout: 30_000 });
}
