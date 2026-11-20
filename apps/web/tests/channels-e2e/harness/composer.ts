import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';
import type { ChannelView } from './channel';
import { stackUrl } from './stack';

/**
 * What a person does in the box they write messages in, beyond typing and
 * Enter: mentioning, attaching, pasting.
 */

/** The button that sends what is in the composer. */
export function sendButton(view: ChannelView): Locator {
  return view.composer.getByRole('button', { name: 'Send message' });
}

/**
 * Types `@` and the start of a name, then picks the person the menu offers
 * with this email address.
 */
export async function mentionPerson(
  view: ChannelView,
  typed: string,
  email: string
): Promise<void> {
  await view.composerText.click();
  await view.page.keyboard.type(`@${typed}`);
  await view.page.getByText(email, { exact: true }).click();
}

/** The chips in a message that name a person. */
export function personMentions(message: Locator): Locator {
  return message.locator('[data-message-content] [data-user-mention]');
}

/** The chips in a message that name a group, such as `@here`. */
export function groupMentions(message: Locator): Locator {
  return message.locator('[data-message-content] [data-group-mention]');
}

/** The files waiting in the composer to be sent. */
export function waitingFiles(view: ChannelView): Locator {
  return view.composer.getByRole('button', { name: /^Remove / });
}

/** Chooses files in the composer's file picker, as "Add" → upload does. */
export async function attach(
  view: ChannelView,
  paths: string[]
): Promise<void> {
  await view.composer
    .locator('input[data-collapsed-input-file-picker]')
    .setInputFiles(paths);
}

/** The files shown under a message. */
export function attachmentsOf(message: Locator): Locator {
  return message.locator('[data-message-attachments]');
}

/** Puts text on the clipboard and pastes it where the caret is. */
export async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('ControlOrMeta+v');
}

/** The line under the newest message that says who is typing. */
export function typingLine(page: Page, name: string): Locator {
  return page
    .locator('[data-channel-scroll]')
    .getByText(`${name} is typing`, { exact: true });
}

/** Waits for the composer to hold exactly this text. */
export async function expectDraft(
  view: ChannelView,
  text: string
): Promise<void> {
  await expect(view.composerText).toHaveText(text);
}

/**
 * A local stack hands the browser upload addresses on the machine's own
 * name. The suite's browser reaches the stack only as `localhost`, so those
 * requests are sent there instead, unchanged. Without this no file can be
 * attached on a local stack; on a stack with one public name it does nothing.
 */
export async function reachUploadStorage(page: Page): Promise<void> {
  const stack = new URL(stackUrl());
  await page.route(
    (url) => url.port === stack.port && url.hostname !== stack.hostname,
    async (route) => {
      const url = new URL(route.request().url());
      const host = url.host;
      url.hostname = stack.hostname;
      const response = await route.fetch({
        url: url.toString(),
        headers: { ...route.request().headers(), host },
      });
      await route.fulfill({ response });
    }
  );
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

/** Writes a small plain-coloured PNG, so no picture is kept in the repo. */
export function writePng(path: string, side = 64): void {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8);
  // Each row: a filter byte, then red, green, blue for every pixel.
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(side * 3, Buffer.from([40, 120, 200])),
  ]);
  const pixels = Buffer.concat(Array.from({ length: side }, () => row));
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(pixels)),
      pngChunk('IEND', Buffer.alloc(0)),
    ])
  );
}
