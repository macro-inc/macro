/**
 * The agent's own browser, for real: Chromium on the computer's display
 * (DISPLAY, the one computer use sees), with a profile that keeps what it
 * signs in to, reachable over CDP on loopback. Each script connects with
 * Playwright, works in the newest tab and disconnects; the browser keeps
 * running. Started on first use, by whichever process needs it.
 */
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import { chromium } from '@macro-inc/muppet/utilities/browser';
import { type Browser, chromium as playwright } from 'playwright-core';
import { childEnvironment } from '../../context/children.ts';
import type { Base } from '../../context/index.ts';
import type { Tab } from './browse.ts';
import { type BrowserConfig, browserConfig, cdpAddress } from './config.ts';

export type BrowserPorts = {
  readonly config: BrowserConfig;
  /** Runs `use` on the newest tab of the agent's browser, starting the browser if it isn't up. */
  readonly withTab: <Value>(
    use: (tab: Tab) => Promise<Value>
  ) => Promise<Value>;
  /** Whether the browser answers on its port. */
  readonly up: () => Promise<boolean>;
};

const answers = async (address: string): Promise<boolean> =>
  fetch(`${address}/json/version`)
    .then((response) => response.ok)
    .catch(() => false);

/** A Playwright page as a `Tab`. */
export const asTab = (page: Awaited<ReturnType<Browser['newPage']>>): Tab => ({
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
    // The editing command, not a key chord: it reads the display's clipboard,
    // where secrets.copy put the value, and the value never passes through here.
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'v',
      code: 'KeyV',
      modifiers: 2,
      commands: ['paste'],
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'v',
      code: 'KeyV',
      modifiers: 2,
    });
    await session.detach();
  },
  press: (key) => page.keyboard.press(key),
  screenshot: async (path) => {
    await page.screenshot({ path });
  },
});

export const browserPorts = (base: Base): BrowserPorts => {
  const config = browserConfig(base);
  const address = cdpAddress(config.port);
  const up = () => answers(address);
  const start = async (): Promise<void> => {
    if (await up()) return;
    await base.disk.makeDirectory(config.profile);
    await chromium({
      profile: config.profile,
      port: config.port,
      headless: false,
      executable: config.executable,
      // The display and the baseline only: none of this process's credentials.
      env: childEnvironment(process.env),
      detached: true,
    });
  };
  return {
    config,
    up,
    withTab: async (use) => {
      await start();
      const browser = await playwright.connectOverCDP(address);
      try {
        // The default context: the profile's, with what it signed in to.
        const [context] = browser.contexts();
        if (context === undefined) throw new Error('the browser has no window');
        const page = context.pages().at(-1) ?? (await context.newPage());
        return await use(asTab(page));
      } finally {
        // Disconnects; the browser keeps running.
        await browser.close();
      }
    },
  };
};

/** What the browser adds to the agent's context. */
export const browserContext = (base: Base) =>
  behavior<Base>().decorate({ browser: browserPorts(base) });

export type BrowserContext = ContextOf<ReturnType<typeof browserContext>>;
