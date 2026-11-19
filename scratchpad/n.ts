import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * The conditions a person's connection can be in. These set the scene of a
 * test; no test asserts on a request. A browser profile (a `BrowserContext`)
 * stands for one device, with its own stored messages and queued writes.
 */

/** Cuts the device off from the network, as a lost connection does. */
export async function goOffline(context: BrowserContext): Promise<void> {
  // DEBUG COPY ONLY: let the app finish loading its code first.
  for (const page of context.pages()) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
    } catch {
      console.log('DBG networkidle not reached');
    }
  }
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
    await route.fetch();
    await route.abort('connectionreset');
  };
  await context.route(SERVICES, handler);
  return () => context.unroute(SERVICES, handler);
}
