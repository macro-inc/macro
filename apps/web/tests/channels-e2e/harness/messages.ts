import type { Locator } from '@playwright/test';
import { ChannelView } from './channel';

/** What stands in the place of a deleted message that has replies. */
export const DELETED = 'This message was deleted.';

type Shown = { author: string | null; text: string };

/**
 * Reads the messages inside the rows as a person does: the text, and the name
 * above it when the message has one. Runs in the page.
 */
function readRows(rows: Element[]): Shown[][] {
  return rows.map((row) =>
    Array.from(row.querySelectorAll('[data-message]')).map((message) => {
      const content =
        message.querySelector('[data-message-content]') ??
        message.querySelector('[data-message-slot="content"]');
      const name = message.querySelector('[data-message-slot="header"] span');
      return {
        author: name?.textContent?.trim() ?? null,
        text: (content?.textContent ?? '').trim(),
      };
    })
  );
}

/**
 * Puts each message under the name a reader takes it to be from: its own,
 * or, for a message drawn without a name, the one on the message above.
 */
function underNames(messages: Shown[]): string[] {
  let author = '(no name)';
  return messages.map((message) => {
    if (message.text === DELETED) {
      author = '(no name)';
      return DELETED;
    }
    if (message.author) author = message.author;
    return `${author}: ${message.text}`;
  });
}

/**
 * An open channel, with what a person does to its messages and threads:
 * send, edit, delete, react, reply.
 */
export class Conversation extends ChannelView {
  private async rows(): Promise<Shown[][]> {
    const rows = await this.list
      .locator('[data-channel-thread-row]')
      .evaluateAll(readRows);
    return rows.filter((row) => row.length > 0);
  }

  private async threadRow(rootId: string): Promise<Shown[]> {
    const rows = await this.thread(rootId).evaluateAll(readRows);
    return rows[0] ?? [];
  }

  /**
   * The messages of the channel itself, top to bottom, without replies. A
   * deleted message that kept its replies reads as `DELETED`.
   */
  async topLevel(): Promise<string[]> {
    return (await this.rows()).map((row) => row[0].text);
  }

  /** The same, each as `<name>: <text>`, by the name it is shown under. */
  async topLevelByAuthor(): Promise<string[]> {
    return underNames((await this.rows()).map((row) => row[0]));
  }

  /** The replies now shown under a message, top to bottom. */
  async replies(rootId: string): Promise<string[]> {
    return (await this.threadRow(rootId)).slice(1).map((reply) => reply.text);
  }

  /** The same, each as `<name>: <text>`, by the name it is shown under. */
  async repliesByAuthor(rootId: string): Promise<string[]> {
    return underNames((await this.threadRow(rootId)).slice(1));
  }

  /** The lines of a message's text, top to bottom. */
  async lines(message: Locator): Promise<string[]> {
    const text = await message.locator('[data-message-content]').innerText();
    return text.split('\n').filter((line) => line !== '');
  }

  /** Reloads the page, as a person who refreshes the tab. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.shown();
  }

  get sendButton(): Locator {
    return this.composer.getByRole('button', { name: 'Send message' });
  }

  /** The box a message's text is edited in, while it is being edited. */
  editor(messageId: string): Locator {
    return this.page
      .locator(`[data-input-id="edit-message-input-${messageId}"]`)
      .getByRole('textbox', { name: 'Edit message' });
  }

  /** Replaces the text in the box that has the keyboard. */
  async retype(text: string): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.type(text);
  }

  /** The dialog that asks before a message is deleted. */
  get deleteDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Delete message' });
  }

  /** Deletes the message from its row of buttons and confirms. */
  async delete(message: Locator): Promise<void> {
    await this.action(message, 'delete');
    await this.deleteDialog.getByRole('button', { name: 'Delete' }).click();
  }

  /** A message's reaction with this emoji. */
  reaction(message: Locator, emoji: string): Locator {
    return message.locator(
      `[data-message-reaction-chip][data-emoji="${emoji}"]`
    );
  }

  /**
   * The reactions on a message as a person reads them: the emoji, and the
   * count when more than one person reacted (`👍`, `👍 2`), sorted.
   */
  async reactions(message: Locator): Promise<string[]> {
    const shown = await message
      .locator('[data-message-reaction-chip]')
      .evaluateAll((chips) =>
        chips.map((chip) => {
          const emoji = chip.getAttribute('data-emoji') ?? '';
          const count = (chip.textContent ?? '').replace(emoji, '').trim();
          return count ? `${emoji} ${count}` : emoji;
        })
      );
    return shown.sort();
  }

  /** Reacts with one of the emoji offered in a message's row of buttons. */
  async quickReact(message: Locator, emoji: string): Promise<void> {
    const actions = await this.actions(message);
    await actions.getByRole('button', { name: `React ${emoji}` }).click();
  }

  /** Picks an emoji by its name in the open emoji picker. */
  async pickEmoji(name: string): Promise<void> {
    const picker = this.page.getByRole('dialog', { name: 'Emoji search' });
    await picker.getByRole('searchbox', { name: 'Search emojis' }).fill(name);
    await picker.getByTitle(name, { exact: true }).click();
  }

  /** The box a reply to this message is written in, once it is open. */
  replyComposer(rootId: string): Locator {
    return this.page
      .locator(`[data-input-id="thread-reply-input-${rootId}"]`)
      .getByRole('textbox', { name: 'Send a reply' });
  }

  /** Opens the box for a reply to the message, from its row of buttons. */
  async startReply(rootId: string): Promise<Locator> {
    await this.action(this.messageById(rootId), 'reply');
    return this.replyComposer(rootId);
  }

  /** Writes a reply to the message and sends it with Enter. */
  async reply(rootId: string, text: string): Promise<void> {
    const composer = await this.startReply(rootId);
    await composer.click();
    await this.page.keyboard.type(text);
    await this.page.keyboard.press('Enter');
  }

  /** The button that stands for the replies a collapsed thread hides. */
  hiddenReplies(rootId: string): Locator {
    return this.thread(rootId).getByTitle('Expand thread');
  }
}
