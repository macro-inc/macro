import {
  type BrowserContext,
  expect,
  type Page,
  type Route,
} from '@playwright/test';

/**
 * The conditions a person's connection can be in. These set the scene of a
 * test; no test asserts on a request. A browser profile (a `BrowserContext`)
 * stands for one device, with its own stored messages and queued writes.
 */

/** How long an open page must have fetched no code to count as done. */
const CODE_QUIET_MS = 3000;
/** The app starts fetching the views it expects next a few seconds in. */
const CODE_FETCH_STARTED_MS = 6000;

/**
 * Waits until the page has stopped fetching the app's code. In its first
 * seconds an open page fetches, one after another, the code of the views it
 * expects to be asked for next. A page cut off in the middle of that offers
 * a reload for a new version and can take the keyboard from the composer
 * (REC-04 is the test of that), which a test about something else must not
 * depend on.
 */
export async function codeFetched(page: Page): Promise<void> {
  let quietSince: number | undefined;
  await expect
    .poll(
      async () => {
        const { now, fetched } = await page.evaluate(() => {
          const fetched = performance
            .getEntriesByType('resource')
            .filter((entry) => /\.(js|css)(\?|$)/.test(entry.name)).length;
          // The browser keeps a bounded list; emptied, it shows what is new.
          performance.clearResourceTimings();
          return { now: performance.now(), fetched };
        });
        if (quietSince === undefined || fetched > 0) quietSince = now;
        return now > CODE_FETCH_STARTED_MS && now - quietSince >= CODE_QUIET_MS;
      },
      { message: 'the page has stopped fetching code', timeout: 60_000 }
    )
    .toBe(true);
}

/**
 * Cuts the device off from the network, as a lost connection does, once its
 * open pages have the app's code: what a person who has had the app open
 * for more than a few seconds loses.
 */
export async function goOffline(context: BrowserContext): Promise<void> {
  await Promise.all(
    context
      .pages()
      .filter((page) => page.url().startsWith('http'))
      .map(codeFetched)
  );
  await context.setOffline(true);
}

/**
 * Cuts the device off at once, whatever its pages are in the middle of: a
 * connection lost in the first seconds after the app opened.
 */
export async function goOfflineAtOnce(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

export async function goOnline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}

/**
 * Cuts one window off and leaves the person's other windows connected, which
 * `goOffline` cannot do. Answers the function that reconnects it.
 */
export async function cutWindowOff(page: Page): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  const conditions = (offline: boolean) =>
    session.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  await conditions(true);
  return async () => {
    await conditions(false);
    await session.detach();
  };
}

/**
 * Makes every answer to this window take `latencyMs` longer, as a very slow
 * link does. Answers the function that restores the link.
 */
export async function slowLink(
  page: Page,
  latencyMs: number
): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  return async () => {
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await session.detach();
  };
}

/** The code of the engine a device keeps channels with. */
const DEVICE_ENGINE = '**/cache_wasm_bg*.wasm';

/**
 * Holds back the code a device keeps channels with, as a slow link does on a
 * first visit: pages open and read from the services, and nothing they read
 * is kept. Answers the function that lets the code through to the pages
 * still open.
 */
export async function holdDeviceBack(
  context: BrowserContext
): Promise<() => Promise<void>> {
  const held: Array<() => void> = [];
  let holding = true;
  const handler = async (route: Route) => {
    if (holding) await new Promise<void>((letGo) => held.push(letGo));
    try {
      await route.fallback();
    } catch {
      // the page that asked is gone
    }
  };
  await context.route(DEVICE_ENGINE, handler);
  return async () => {
    holding = false;
    for (const letGo of held) letGo();
  };
}

const MESSAGE_MUTATION = /mutation (Send|Edit|Delete|ReactTo)ChannelMessage\b/;

/** Whether the request asks the services to change a message. */
function isMessageWrite(route: Route): boolean {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  if (path.startsWith('/dss/messages/')) {
    return method !== 'GET' && !path.endsWith('/typing');
  }
  if (path.endsWith('/items/soup/graphql') && method === 'POST') {
    return MESSAGE_MUTATION.test(request.postData() ?? '');
  }
  return false;
}

const SERVICES = /\/dss\//;

/**
 * The services cannot be reached for message writes, while the app itself
 * still loads: what a person on a network that drops their requests has. A
 * page can be reloaded in this state, which it cannot be offline. Answers the
 * function that lets writes through again.
 */
export async function blockWrites(
  context: BrowserContext
): Promise<() => Promise<void>> {
  const handler = async (route: Route) => {
    if (isMessageWrite(route)) await route.abort('connectionfailed');
    else await route.fallback();
  };
  await context.route(SERVICES, handler);
  return () => context.unroute(SERVICES, handler);
}

/**
 * Message writes reach the services, which carry them out, but their answers
 * never come back: the connection drops between the two. Answers the
 * function that restores the connection.
 */
export async function loseWriteAnswers(
  context: BrowserContext
): Promise<() => Promise<void>> {
  const handler = async (route: Route) => {
    if (!isMessageWrite(route)) {
      await route.fallback();
      return;
    }
    // A request still on its way when the connection is restored, or when
    // its page goes, has nothing left to drop.
    try {
      await route.fetch();
      await route.abort('connectionreset');
    } catch {
      return;
    }
  };
  await context.route(SERVICES, handler);
  return () => context.unroute(SERVICES, handler);
}

/** The requests a page reads its list of channels with, a hundred to a page. */
const CHANNEL_LIST = '**/dss/comms/channels?**';

/**
 * Resolves when the page has read its whole list of channels. Start it before
 * the page opens. A person with thousands of channels reads the list for
 * seconds, and a rename saved meanwhile never shows in the header (CHN-16);
 * a cast that has run the suite some forty times is such a person.
 */
export function channelListRead(page: Page): Promise<void> {
  return page
    .waitForResponse(
      async (response) => {
        if (!response.url().includes('/dss/comms/channels?')) return false;
        if (!response.ok()) return false;
        try {
          const body: { next_cursor?: string | null } = await response.json();
          return !body.next_cursor;
        } catch {
          // the page moved on before the answer could be read
          return false;
        }
      },
      { timeout: 120_000 }
    )
    .then(() => undefined);
}

/**
 * Holds back the answers to the page's reading of its list of channels: the
 * services have answered, the page has not been told. Returns the step that
 * lets them through, which first waits for one to be held.
 */
export async function holdChannelList(
  page: Page
): Promise<() => Promise<void>> {
  const held: Array<() => void> = [];
  let holding = true;
  await page.route(CHANNEL_LIST, async (route) => {
    try {
      const answer = await route.fetch();
      if (holding) await new Promise<void>((letGo) => held.push(letGo));
      await route.fulfill({ response: answer });
    } catch {
      // the page that asked is gone
    }
  });
  return async () => {
    await expect
      .poll(() => held.length, { message: 'an answer is held back' })
      .toBeGreaterThan(0);
    holding = false;
    for (const letGo of held) letGo();
  };
}
