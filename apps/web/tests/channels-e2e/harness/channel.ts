import { expect, type Locator, type Page } from '@playwright/test';

/**
 * What a person sees and does in one open channel. Everything is found the
 * way the person finds it: by the text of a message, the name of a button,
 * the place in the list.
 */
export class ChannelView {
  constructor(
    readonly page: Page,
    readonly channelId: string
  ) {}

  /** The list of messages, which scrolls. */
  get list(): Locator {
    return this.page.locator('[data-channel-scroll]');
  }

  get composer(): Locator {
    return this.page.locator(
      `[data-input-id="channel-input-${this.channelId}"]`
    );
  }

  get composerText(): Locator {
    return this.composer.locator('[contenteditable="true"]').first();
  }

  /**
   * Opens the channel by its address, optionally at a message. `unwaited`
   * returns as soon as the page is asked for, for a test that looks at
   * what shows while the channel loads.
   */
  async open(
    target: { messageId?: string; threadId?: string; unwaited?: boolean } = {}
  ): Promise<void> {
    const query = new URLSearchParams();
    if (target.messageId) query.set('channel_message_id', target.messageId);
    if (target.threadId) query.set('channel_thread_id', target.threadId);
    const search = query.size > 0 ? `?${query}` : '';

    await this.page.goto(`/app/channel/${this.channelId}${search}`);
    if (!target.unwaited) await this.shown();
  }

  /**
   * Starts noting which messages the app marks as the one a link led to.
   * The mark shows for a second, so it is noted as it happens rather than
   * looked for afterwards. Call before opening the channel.
   */
  async noteMarkedMessages(): Promise<void> {
    await this.page.addInitScript(() => {
      const marked: string[] = [];
      Object.assign(window, { __markedMessages: marked });
      const note = () => {
        for (const node of document.querySelectorAll(
          '[data-message][data-targeted]'
        )) {
          const id = node.getAttribute('data-message-id');
          if (id && !marked.includes(id)) marked.push(id);
        }
      };
      new MutationObserver(note).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-targeted'],
      });
    });
  }

  /** The ids of the messages marked since `noteMarkedMessages`, in order. */
  async markedMessages(): Promise<string[]> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __markedMessages?: string[] })
          .__markedMessages ?? []
    );
  }

  /** Asserts that exactly this message was marked as the link's target. */
  async expectMarked(id: string): Promise<void> {
    await expect
      .poll(() => this.markedMessages(), {
        message: 'messages marked as the target of the link',
      })
      .toEqual([id]);
  }

  /**
   * The first message wholly inside the window, and where its top is. What
   * a person scrolled up is reading.
   */
  async topVisible(): Promise<{ id: string; top: number }> {
    return this.list.evaluate((list) => {
      const frame = list.getBoundingClientRect();
      for (const node of list.querySelectorAll('[data-message]')) {
        const box = node.getBoundingClientRect();
        if (box.top >= frame.top && box.bottom <= frame.bottom) {
          return {
            id: node.getAttribute('data-message-id') ?? '',
            top: Math.round(box.top),
          };
        }
      }
      throw new Error('no message is wholly inside the window');
    });
  }

  /** Waits until this channel, and not another, is the one on screen. */
  async shown(): Promise<void> {
    await expect(this.composer).toBeVisible({ timeout: 60_000 });
  }

  /** The message with exactly this text, wherever it is in the list. */
  message(text: string): Locator {
    return this.list.locator('[data-message]').filter({
      has: this.page
        .locator('[data-message-content]')
        .getByText(text, { exact: true }),
    });
  }

  messageById(id: string): Locator {
    return this.list.locator(`[data-message-id="${id}"]`);
  }

  /**
   * The texts of the messages now in the list, top to bottom, without the
   * replies under them. The list keeps only the rows near the window, so
   * this is the part on screen and a little around it.
   */
  async texts(): Promise<string[]> {
    return this.list.locator('[data-channel-thread-row]').evaluateAll((rows) =>
      rows.flatMap((row) => {
        const content = row.querySelector<HTMLElement>(
          '[data-message-content]'
        );
        return content ? [(content.textContent ?? '').trim()] : [];
      })
    );
  }

  /**
   * The same, once every message in the list has its text: a message is
   * drawn a moment before its text is. A message that stays blank fails
   * here.
   */
  async drawnTexts(): Promise<string[]> {
    let texts: string[] = [];
    await expect
      .poll(
        async () => {
          texts = await this.texts();
          return texts.filter((text) => text === '').length;
        },
        { message: 'messages drawn without their text' }
      )
      .toBe(0);
    return texts;
  }

  /** The thread a message starts: the message and its replies. */
  thread(rootId: string): Locator {
    return this.list.locator('[data-channel-thread-row]').filter({
      has: this.page.locator(`[data-message-id="${rootId}"]`),
    });
  }

  /** The texts of the replies now shown under a message, top to bottom. */
  async replyTexts(rootId: string): Promise<string[]> {
    const all = await this.thread(rootId)
      .locator('[data-message-content]')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? '').trim())
      );
    return all.slice(1);
  }

  /** Asserts that the list ends with exactly these messages, in this order. */
  async expectEndsWith(expected: string[]): Promise<void> {
    await expect
      .poll(async () => (await this.texts()).slice(-expected.length), {
        message: 'the last messages in the list',
      })
      .toEqual(expected);
  }

  /** How far the list is from showing its very end, in pixels. */
  async distanceFromBottom(): Promise<number> {
    return this.list.evaluate(
      (list) => list.scrollHeight - list.scrollTop - list.clientHeight
    );
  }

  async expectAtBottom(): Promise<void> {
    await expect
      .poll(() => this.distanceFromBottom(), {
        message: 'distance of the list from its end',
      })
      .toBeLessThanOrEqual(2);
  }

  /** Turns the wheel over the list, as a person reading back does. */
  async wheel(deltaY: number): Promise<void> {
    const box = await this.list.boundingBox();
    if (!box) throw new Error('the message list is not on screen');
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.wheel(0, deltaY);
  }

  /**
   * Reads on from where the list is, toward its start (`back`) or its end
   * (`forward`), until the message `until` is on screen. Answers every
   * message text met on the way, oldest first.
   */
  async readTo(
    until: string,
    direction: 'back' | 'forward'
  ): Promise<string[]> {
    const seen: string[] = [];
    const last = this.message(until);

    // The list holds only the rows near the window. Each look adds the rows
    // that continue what is already known, on the side being read toward.
    const record = async () => {
      const now = await this.drawnTexts();
      if (seen.length === 0) {
        seen.push(...now);
        return;
      }

      if (direction === 'back') {
        const oldestKnown = now.indexOf(seen[0]);
        if (oldestKnown === -1)
          throw new Error(
            `lost my place above "${seen[0]}": the list shows ${JSON.stringify(now)}`
          );
        seen.unshift(...now.slice(0, oldestKnown));
        return;
      }

      const newestKnown = now.lastIndexOf(seen[seen.length - 1]);
      if (newestKnown === -1)
        throw new Error(
          `lost my place below "${seen[seen.length - 1]}": the list shows ${JSON.stringify(now)}`
        );
      seen.push(...now.slice(newestKnown + 1));
    };

    // Losing the place is final: more scrolling cannot bring back rows the
    // list skipped, so it ends the reading instead of being tried again.
    let lost: unknown;
    const look = async () => {
      try {
        await record();
      } catch (error) {
        lost = error;
      }
    };

    await record();
    await expect(async () => {
      if (lost) return;
      await this.wheel(direction === 'back' ? -600 : 600);
      await look();
      if (lost) return;
      await expect(last).toBeVisible({ timeout: 300 });
    }).toPass({ timeout: 150_000, intervals: [50] });
    if (lost) throw lost;
    await record();
    return seen;
  }

  /**
   * Scrolls down a little at a time until the app offers "Scroll to
   * bottom", which it does to a person heading back down from far up.
   */
  async scrollDownUntilOffered(): Promise<Locator> {
    const button = this.page.getByRole('button', { name: 'Scroll to bottom' });
    await expect(async () => {
      await this.wheel(100);
      await expect(button).toBeVisible({ timeout: 400 });
    }).toPass({ timeout: 20_000, intervals: [50] });
    return button;
  }

  /** Types the text and sends it with Enter. */
  async send(text: string): Promise<void> {
    await this.composerText.click();
    await this.page.keyboard.type(text);
    await this.page.keyboard.press('Enter');
  }

  /** The row of buttons that shows when the pointer is over a message. */
  async actions(message: Locator): Promise<Locator> {
    await message.hover();
    const actions = message.locator('[data-message-hover-actions]');
    await expect(actions).toBeVisible();
    return actions;
  }

  async action(message: Locator, name: string): Promise<void> {
    const actions = await this.actions(message);
    await actions.locator(`[data-message-action="${name}"]`).click();
  }
}

/** The list of conversations beside the channel. */
export function conversations(page: Page): Locator {
  return page.getByRole('tree', { name: 'Conversations' });
}

/** A conversation's row in that list, by its name. */
export function conversationRow(page: Page, name: string): Locator {
  return conversations(page).getByRole('treeitem').filter({ hasText: name });
}
