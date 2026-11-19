import type { Locator, Page } from '@playwright/test';
import { type ChannelView, conversations } from './channel';
import { expect } from './fixtures';
import { apiFor, type PersonKey } from './people';

/**
 * What a person does to a channel rather than in it: making, renaming and
 * deleting it, its members, and getting into one they are not in.
 */

/** The bar above an open channel: its name, its menu, its tabs. */
export function channelHeader(page: Page): Locator {
  return page.getByRole('main').locator('[data-view-shell-top-bar]');
}

/** Opens the menu beside the channel's name and chooses from it. */
export async function chooseChannelAction(
  page: Page,
  name: string
): Promise<void> {
  // The menu closes by itself when the bar above the channel is drawn again,
  // as it is just after a favorite or a rename: open it again until the
  // entry takes the click.
  const entry = channelAction(page, name);
  await expect(async () => {
    if (!(await entry.isVisible())) {
      await page.getByRole('button', { name: 'Channel actions' }).click();
    }
    await entry.click({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/** An entry of the open "Channel actions" menu. */
export function channelAction(page: Page, name: string): Locator {
  return page
    .getByRole('menu', { name: 'Channel actions' })
    .getByRole('menuitem', { name });
}

export type ChannelTab = 'Messages' | 'Attachments' | 'Calls' | 'Participants';

/** Switches between the channel's sections in its header. */
export async function showTab(page: Page, name: ChannelTab): Promise<void> {
  await page
    .getByRole('radiogroup', { name: 'Channel sections' })
    .getByText(name, { exact: true })
    .click();
}

/** The lines the app writes into a channel itself: renames, joins, removals. */
export function systemLines(page: Page): Locator {
  return page.locator('[data-channel-scroll] [data-system-activity]');
}

/** The system line that says exactly this, without its time. */
export function systemLine(page: Page, text: string): Locator {
  return systemLines(page).filter({ hasText: text });
}

/**
 * What the list shows now, top to bottom: each message's text and each
 * system line's sentence, without times or buttons.
 */
export async function timeline(view: ChannelView): Promise<string[]> {
  return view.list
    .locator('[data-message-content], [data-system-activity]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        for (const extra of copy.querySelectorAll('time, button')) {
          extra.remove();
        }
        return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
      })
    );
}

/** Asserts that the list ends with exactly these messages and system lines. */
export async function expectTimelineEndsWith(
  view: ChannelView,
  expected: string[]
): Promise<void> {
  await expect
    .poll(async () => (await timeline(view)).slice(-expected.length), {
      message: 'the last messages and system lines in the list',
    })
    .toEqual(expected);
}

/** A channel's row in the list of conversations, outside Favorites. */
export function sidebarRow(page: Page, channelId: string): Locator {
  return conversations(page).locator(`[data-key="channel:${channelId}"]`);
}

/** A channel's row under Favorites. */
export function favoriteRow(page: Page, channelId: string): Locator {
  return conversations(page).locator(
    `[data-key="favorite:channel:${channelId}"]`
  );
}

export type SidebarSection =
  | 'favorites'
  | 'direct_messages'
  | 'team_channels'
  | 'channels';

/** The heading a channel's row sits under in the list of conversations. */
export async function sidebarSectionOf(
  page: Page,
  channelId: string
): Promise<SidebarSection | undefined> {
  return conversations(page).evaluate((tree, id) => {
    const headings = [
      'favorites',
      'direct_messages',
      'team_channels',
      'channels',
    ];
    let under: string | undefined;
    for (const row of tree.querySelectorAll('[data-key]')) {
      const key = row.getAttribute('data-key') ?? '';
      if (headings.includes(key)) under = key;
      if (key === `channel:${id}`) return under;
    }
    return undefined;
  }, channelId) as Promise<SidebarSection | undefined>;
}

/**
 * Types into "Search conversations", which narrows the list to the
 * conversations with that name. The list draws only the rows near its
 * window, so this is how a person with many channels finds one.
 */
export async function filterConversations(
  page: Page,
  text: string
): Promise<void> {
  const box = page.getByRole('searchbox', { name: 'Search conversations' });
  if (!(await box.isVisible())) {
    await page.getByRole('button', { name: 'Search conversations' }).click();
  }
  await box.fill(text);
}

/** The id of the channel the page shows, from its address. */
export function openChannelId(page: Page): string {
  const id = /\/channels?\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`no channel is open at ${page.url()}`);
  return id;
}

/**
 * Makes a channel the way a person does: "Create channel or direct
 * message", its name, who can see it, and no invitations. Answers the new
 * channel's id once the app has opened it.
 */
export async function createChannelInApp(
  page: Page,
  name: string,
  visibility: 'Team' | 'Private'
): Promise<string> {
  await page
    .getByRole('button', { name: 'Create channel or direct message' })
    .click();
  await page.getByRole('menuitem', { name: 'New channel' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a channel' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Next' }).click();
  // The choice is named "Private" in one layout of this dialog and
  // "Private — only specific people" in another; either way it is the one
  // whose label begins with the word.
  await dialog
    .getByRole('radiogroup', { name: 'Visibility' })
    .getByText(new RegExp(`^${visibility}\\b`))
    .click();
  await expect(
    dialog.getByRole('radio', { name: new RegExp(`^${visibility}\\b`) })
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  const invite = page.getByRole('dialog', {
    name: `Add people or agents to ${name}`,
  });
  await invite.getByRole('button', { name: 'Skip for now' }).click();
  await expect(invite).toBeHidden();
  await expect(page).toHaveURL(/\/channels?\/[0-9a-f-]{36}/);
  return openChannelId(page);
}

/**
 * Adds a person through the header's Invite dialog by their address, which
 * the dialog accepts for anyone, on the team or off it.
 */
export async function inviteByEmail(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Invite' }).click();
  const dialog = page.getByRole('dialog', { name: /^Invite people to / });
  const box = dialog.getByRole('combobox', {
    name: 'Search people or email addresses',
  });
  await box.click();
  await box.fill(email);
  // The one row reads "Invite <address>" until the device's own list of
  // people answers; if it knows the address, the row becomes that person's,
  // sometimes as it is being clicked (MEM-01). Either row invites them.
  await dialog.getByRole('option').filter({ hasText: email }).first().click();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A person's row in the Participants tab. */
export function participant(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('link', { name: `Message ${name}` });
}

/** A person's row in the Participants tab: their name, role and remove button. */
export function participantRow(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .getByLabel('Participants list')
    .locator('div')
    .filter({ has: page.getByRole('link', { name: `Message ${name}` }) })
    .filter({ has: page.getByRole('button', { name: /remove participant/i }) })
    .last();
}

/** Removes a person with the button beside their row in the Participants tab. */
export async function removeParticipantInApp(
  page: Page,
  name: string
): Promise<void> {
  await participantRow(page, name)
    .getByRole('button', { name: 'Remove participant', exact: true })
    .click();
  await expect(participant(page, name)).toHaveCount(0);
}

/** The panel a person sees in place of a channel they are not in. */
export function noAccess(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('status')
    .filter({
      has: page.getByRole('heading', {
        name: "You don't have access to this channel",
      }),
    });
}

async function asPerson(
  key: PersonKey,
  what: string,
  act: (
    http: Awaited<ReturnType<typeof apiFor>>
  ) => Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>
): Promise<void> {
  const http = await apiFor(key);
  try {
    const response = await act(http);
    if (!response.ok()) {
      throw new Error(
        `${what} failed (${response.status()}): ${await response.text()}`
      );
    }
  } finally {
    await http.dispose();
  }
}

/** Deletes a channel through the service, as that person. */
export function deleteChannel(
  key: PersonKey,
  channelId: string
): Promise<void> {
  return asPerson(key, 'delete channel', (http) =>
    http.delete(`/dss/channels/${channelId}`)
  );
}

/**
 * Finds a conversation by its name with "Search conversations" and answers
 * its row. The list draws only the rows near its window and orders them by
 * what happened last, so with many channels this is the one way to be sure
 * a conversation is, or has just become, part of a person's list.
 */
export async function findConversation(
  page: Page,
  name: string
): Promise<Locator> {
  const row = conversations(page).getByRole('treeitem', { name });
  await expect(async () => {
    await filterConversations(page, '');
    await filterConversations(page, name);
    await expect(row).toBeVisible({ timeout: 3000 });
  }).toPass();
  return row;
}
