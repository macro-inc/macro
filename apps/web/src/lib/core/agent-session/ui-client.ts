/**
 * This tab's id, sent with the prompts typed in it so what an agent opens for
 * the person (`macro.ui.open`) reaches this tab and no other. It names a tab,
 * not a person, and grants nothing.
 *
 * Kept in sessionStorage, so every reload of the tab keeps it, including one
 * after a crash or a discarded background tab. A browser copies sessionStorage
 * into a tab duplicated or opened from this one, and two live tabs with one id
 * would both open what the agent asks. So each page says hello with its id on
 * a BroadcastChannel, and when two live pages hold one id, the one that took
 * it later mints its own. A page in the back/forward cache isn't live: it
 * leaves the channel, and says hello again when it comes back.
 */

import { z } from 'zod';

const STORAGE_KEY = 'macro.ui-client-id';
const CHANNEL = 'macro.ui-client';

const storedId = z.uuid();

/** A page's id, when it took it, and a tie-break for the same moment. */
const helloSchema = z.object({
  id: z.string(),
  since: z.number(),
  page: z.string(),
});

type Hello = z.infer<typeof helloSchema>;

let current: string | undefined;
let self: Omit<Hello, 'id'> | undefined;
let channel: BroadcastChannel | undefined;

function readStored(): string | undefined {
  try {
    const parsed = storedId.safeParse(sessionStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function store(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the id lasts as long as this page.
  }
}

/** Whether this page took its id after the page that said `hello`. */
function tookItLater(hello: Hello): boolean {
  if (!self) return false;
  if (self.since !== hello.since) return self.since > hello.since;

  return self.page > hello.page;
}

function sayHello() {
  if (!current || !self) return;

  channel?.postMessage({ id: current, ...self } satisfies Hello);
}

/** Another live page holds this id: the later one mints its own. */
function onHello(event: MessageEvent) {
  const hello = helloSchema.safeParse(event.data);
  if (!hello.success || hello.data.id !== current) return;

  if (tookItLater(hello.data)) {
    current = crypto.randomUUID();
    store(current);
    return;
  }

  // The other page took it later; tell it so.
  sayHello();
}

function join() {
  if (channel || typeof BroadcastChannel === 'undefined') return;

  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', onHello);
  sayHello();
}

function leave() {
  channel?.close();
  channel = undefined;
}

/** Back from the back/forward cache: live again. */
function rejoin(event: PageTransitionEvent) {
  if (event.persisted) join();
}

/**
 * This tab's id, minted on first use. The app shell calls it as it starts,
 * so this page answers a tab duplicated from it from the start.
 */
export function uiClientId(): string {
  if (current) return current;

  current = readStored() ?? crypto.randomUUID();
  self = {
    since: performance.timeOrigin + performance.now(),
    page: crypto.randomUUID(),
  };
  store(current);
  join();
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', rejoin);
  return current;
}
