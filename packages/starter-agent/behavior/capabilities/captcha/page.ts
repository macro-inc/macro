/**
 * The page side of a solve, over the agent's own browser (CDP): read the
 * facts `detect` needs, put a solved token where the widget keeps it and run
 * the page's callback, and see what the page did after. Reads no page text
 * beyond the title, and never clicks or types into the widget.
 */
import { chromium } from 'playwright-core';
import type { Challenge, PageFacts, Widget } from './detect.ts';

/**
 * The little of the page's DOM the functions below touch, typed here: they
 * run in the page, and this package has no DOM types of its own.
 */
type PageElement = {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  value?: string;
  textContent: string | null;
};
type PageDocument = {
  readonly title: string;
  readonly scripts: ArrayLike<{ readonly src: string }>;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  getElementById(id: string): unknown;
  getElementsByClassName(name: string): { readonly length: number };
};
type PageGlobals = { readonly document: PageDocument } & Record<
  string,
  unknown
>;

export type Page = Awaited<
  ReturnType<Awaited<ReturnType<typeof chromium.connectOverCDP>>['newPage']>
>;

/** Runs `use` on the newest tab of the browser at `endpoint`, then disconnects. */
export const withCurrentPage = async <Value>(
  endpoint: string,
  use: (page: Page) => Promise<Value>
): Promise<Value> => {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const [context] = browser.contexts();
    if (context === undefined) throw new Error('the browser has no window');
    const page = context.pages().at(-1);
    if (page === undefined) throw new Error('the browser has no tab open');
    return await use(page);
  } finally {
    // Disconnects; the browser keeps running.
    await browser.close();
  }
};

/** The tab's DevTools target id: stable for the tab's life, across connections. */
export const targetIdOf = async (page: Page): Promise<string> => {
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } finally {
    await session.detach();
  }
};

/**
 * Runs `use` on the tab with DevTools target `targetId`, or answers
 * undefined when that tab is gone, then disconnects.
 */
export const withTargetPage = async <Value>(
  endpoint: string,
  targetId: string,
  use: (page: Page) => Promise<Value>
): Promise<Value | undefined> => {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    for (const context of browser.contexts())
      for (const page of context.pages())
        if ((await targetIdOf(page)) === targetId) return await use(page);
    return undefined;
  } finally {
    await browser.close();
  }
};

/** Ids and classes `detect` treats as a challenge page's own. */
const markerNames = [
  'challenge-form',
  'cf-chl-widget',
  'h-captcha',
  'aws-waf-token',
  'geetest_captcha',
  'px-captcha',
  'frc-captcha',
  'mtcaptcha',
];

type RawWidget = {
  readonly className: string;
  readonly siteKey: string;
  readonly size: string | null;
  readonly action: string | null;
  readonly cdata: string | null;
  readonly dataS: string | null;
  readonly callback: string | null;
};

const present = (value: string | null): string | undefined =>
  value === null || value === '' ? undefined : value;

const asWidget = (raw: RawWidget): Widget => {
  const optional = {
    size: present(raw.size),
    action: present(raw.action),
    cdata: present(raw.cdata),
    dataS: present(raw.dataS),
    callback: present(raw.callback),
  };
  const defined = Object.fromEntries(
    Object.entries(optional).filter(([, value]) => value !== undefined)
  );
  return { className: raw.className, siteKey: raw.siteKey, ...defined };
};

/** What `detect` needs from the current page. */
export const readFacts = async (page: Page): Promise<PageFacts> => {
  const read = await page.evaluate((markers) => {
    const { document } = globalThis as unknown as PageGlobals;
    const widgets = Array.from(document.querySelectorAll('[data-sitekey]')).map(
      (element) => ({
        className: element.getAttribute('class') ?? '',
        siteKey: element.getAttribute('data-sitekey') ?? '',
        size: element.getAttribute('data-size'),
        action: element.getAttribute('data-action'),
        cdata: element.getAttribute('data-cdata'),
        dataS: element.getAttribute('data-s'),
        callback: element.getAttribute('data-callback'),
      })
    );
    const scripts = Array.from(document.scripts).map((script) => script.src);
    const found = markers.filter(
      (name) =>
        document.getElementById(name) !== null ||
        document.getElementsByClassName(name).length > 0
    );
    return { title: document.title, widgets, scripts, markers: found };
  }, markerNames);
  return {
    url: page.url(),
    title: read.title,
    widgets: read.widgets
      .filter((widget) => widget.siteKey !== '')
      .map(asWidget),
    frames: page.frames().map((frame) => frame.url()),
    scripts: read.scripts.filter((src) => src !== ''),
    markers: read.markers,
  };
};

/** What putting a token in the page did. */
export type Injected = {
  /** Response fields that now hold the token. */
  readonly filled: number;
  /** The widget's own callback: run, threw, named but not found, or none named. */
  readonly callback: 'ran' | 'threw' | 'missing' | 'none';
  /** reCAPTCHA v3: `grecaptcha.execute` now answers with the token. */
  readonly executeAnswered: boolean;
};

/** Where each kind's widget keeps its token. */
const responseFields: Record<Challenge['kind'], readonly string[]> = {
  recaptchaV2: ['g-recaptcha-response'],
  recaptchaV3: ['g-recaptcha-response'],
  turnstile: ['cf-turnstile-response', 'g-recaptcha-response'],
};

/**
 * Puts `token` where the page reads it: the widget's response fields, and
 * for reCAPTCHA v3, `grecaptcha.execute`, which the page calls when it
 * wants a token. Then runs the widget's callback, if it names one, as the
 * widget would once solved.
 */
export const injectToken = (
  page: Page,
  {
    challenge,
    token,
    callback,
  }: {
    readonly challenge: Challenge;
    readonly token: string;
    readonly callback?: string;
  }
): Promise<Injected> =>
  page.evaluate(
    ({ names, token, callback, v3 }) => {
      const scope = globalThis as unknown as PageGlobals;
      let filled = 0;
      for (const name of names) {
        const fields = scope.document.querySelectorAll(
          `[name="${name}"], #${name}`
        );
        for (const field of Array.from(fields)) {
          field.value = token;
          if (field.tagName === 'TEXTAREA') field.textContent = token;
          filled += 1;
        }
      }

      // The page's grecaptcha is its own global; v3 asks it for a token.
      type Grecaptcha = {
        execute?: () => Promise<string>;
        enterprise?: { execute?: () => Promise<string> };
      };
      let executeAnswered = false;
      if (v3) {
        const grecaptcha = scope.grecaptcha as Grecaptcha | undefined;
        if (grecaptcha !== undefined) {
          // Answers once with the token, then puts the page's own back: a
          // token is single-use, and a later call needs a fresh one.
          const once = (
            owner: { execute?: () => Promise<string> },
            original: (() => Promise<string>) | undefined
          ) => {
            owner.execute = () => {
              if (original === undefined) delete owner.execute;
              else owner.execute = original;
              return Promise.resolve(token);
            };
          };
          once(grecaptcha, grecaptcha.execute);
          if (grecaptcha.enterprise !== undefined)
            once(grecaptcha.enterprise, grecaptcha.enterprise.execute);
          executeAnswered = true;
        }
      }

      if (callback === null)
        return { filled, callback: 'none' as const, executeAnswered };
      // `data-callback` names a global function, possibly dotted (`app.onSolved`).
      let target: unknown = scope;
      for (const part of callback.split('.'))
        target =
          target === null || target === undefined
            ? undefined
            : (target as Record<string, unknown>)[part];
      if (typeof target !== 'function')
        return { filled, callback: 'missing' as const, executeAnswered };
      try {
        (target as (token: string) => unknown)(token);
        return { filled, callback: 'ran' as const, executeAnswered };
      } catch {
        return { filled, callback: 'threw' as const, executeAnswered };
      }
    },
    {
      names: responseFields[challenge.kind],
      token,
      callback: callback ?? null,
      v3: challenge.kind === 'recaptchaV3',
    }
  );

/** How long the page gets to react to a token before it is looked at again. */
export const settleMs = 5_000;

/** Waits for the page to navigate or settle after a token, up to {@link settleMs}. */
export const settle = async (page: Page, from: string): Promise<void> => {
  try {
    await page.waitForURL((url) => url.href !== from, { timeout: settleMs });
    await page.waitForLoadState('domcontentloaded', { timeout: settleMs });
  } catch {
    // No navigation: the page reacted in place, or not at all.
  }
};
