/**
 * A running Chromium's newest tab, over CDP with Playwright, as a few typed
 * steps. Each use connects, works in the default context (the profile's,
 * with what it is signed in to) and disconnects; the browser keeps running.
 */
import { chromium as playwright } from 'playwright-core';

type Page = Awaited<
  ReturnType<Awaited<ReturnType<typeof playwright.connectOverCDP>>['newPage']>
>;

/** By CSS selector, or else the link or button with this exact text. */
export type Target = { readonly selector: string } | { readonly text: string };

export type Tab = {
  readonly goto: (url: string) => Promise<void>;
  readonly url: () => string;
  readonly title: () => Promise<string>;
  /** The text of the page, or of the first element matching `selector`. */
  readonly text: (selector?: string) => Promise<string>;
  readonly click: (target: Target) => Promise<void>;
  /** Replaces what's in the field with `text`. */
  readonly fill: (selector: string, text: string) => Promise<void>;
  /**
   * Focuses the field and pastes the display's clipboard into it, with
   * Chromium's paste command: what is pasted never passes through here.
   */
  readonly paste: (selector: string) => Promise<void>;
  /** A key or chord, e.g. `Enter`, `Control+A`. */
  readonly press: (key: string) => Promise<void>;
  readonly screenshot: (path: string) => Promise<void>;
  /** Brings the tab to the front and makes its window fill the screen. */
  readonly fullscreen: () => Promise<void>;
};

const control = 2;

/** A Playwright page as a `Tab`. */
export const asTab = (page: Page): Tab => ({
  goto: async (url) => {
    await page.goto(url);
  },
  url: () => page.url(),
  title: () => page.title(),
  text: (selector) => page.innerText(selector ?? 'body'),
  click: (target) =>
    'selector' in target
      ? page.click(target.selector)
      : page
          .getByRole('link', { name: target.text, exact: true })
          .or(page.getByRole('button', { name: target.text, exact: true }))
          .first()
          .click(),
  fill: (selector, text) => page.fill(selector, text),
  paste: async (selector) => {
    await page.focus(selector);
    const session = await page.context().newCDPSession(page);
    const key = { key: 'v', code: 'KeyV', modifiers: control };
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...key,
      commands: ['paste'],
    });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await session.detach();
  },
  press: (key) => page.keyboard.press(key),
  screenshot: async (path) => {
    await page.screenshot({ path });
  },
  fullscreen: async () => {
    await page.bringToFront();
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });
    await session.detach();
  },
});

/** Runs `use` on the newest tab of the browser at `endpoint` (e.g. `http://127.0.0.1:9223`). */
export const withTab = async <Value>(
  endpoint: string,
  use: (tab: Tab) => Promise<Value>
): Promise<Value> => {
  const browser = await playwright.connectOverCDP(endpoint);
  try {
    const [context] = browser.contexts();
    if (context === undefined) throw new Error('the browser has no window');
    const page = context.pages().at(-1) ?? (await context.newPage());
    return await use(asTab(page));
  } finally {
    // Disconnects; the browser keeps running.
    await browser.close();
  }
};
