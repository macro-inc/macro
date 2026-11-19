import { readFileSync, writeFileSync } from 'node:fs';
const edit = (f: string, pairs: [string, string][]) => {
  let t = readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 60)); t = t.replace(a, () => b); }
  writeFileSync(f, t);
};
edit('harness/network.ts', [[`const MESSAGE_MUTATION =`, `/** The code of the engine a device keeps channels with. */
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

const MESSAGE_MUTATION =`]]);
edit('offline.spec.ts', [
  [`  goOnline,
  slowLink,`, `  goOnline,
  holdDeviceBack,
  slowLink,`],
  [`  // Known defect: after a reload with no connection the page knows only about
  // a hundred of the newest channels, and says "Conversation
  // unavailable" for an older one although the device holds its messages.
  knownDefect('on');
`, ''],
  [`  await expect
    .poll(async () => (await offline.replies(root.id)).slice(0, 3))
    .toEqual(replies.slice(0, 3));
  // Defect, in some runs: only the first three replies show.
  await failsSometimes(async () => {
    await expect.poll(() => offline.replies(root.id)).toEqual(replies);
  });
});`, `  await expect.poll(() => offline.replies(root.id)).toEqual(replies);
});`],
  [`// If this fails, a person cannot go back to an old message they followed a`, `// If this fails, what a person read just before a reload, in the second or
// two a new page takes to start keeping channels, is not on their device:
// without a connection the thread they read shows no replies.
test('OFF-14 a thread read on a page reloaded before the device kept it shows its replies with no connection', async ({
  pageFor,
  ada,
  ben,
}) => {
  const channel = await ada.createChannel({ members: [ben.person] });
  const elsewhere = await ada.createChannel({ members: [ben.person] });
  await ada.post(elsewhere.id, 'elsewhere');
  const root = await ada.post(channel.id, 'root');
  const replies = ['reply 1', 'reply 2', 'reply 3', 'reply 4', 'reply 5'];
  for (const text of replies) {
    await ben.post(channel.id, text, { threadId: root.id });
  }
  const page = await pageFor('ben');
  // The page that reads the thread never gets to keep it.
  const letDeviceStart = await holdDeviceBack(page.context());
  const view = new Conversation(page, channel.id);
  await view.open();
  await view.hiddenReplies(root.id).click();
  await expect.poll(() => view.replies(root.id)).toEqual(replies);
  // A device fetches the channels a person had open lately by itself, but
  // not their threads: only the thread shows what the lost page left behind.
  await new Conversation(page, elsewhere.id).open();
  await letDeviceStart();

  const offline = await openOffline(page, channel);
  await offline.hiddenReplies(root.id).click();

  await expect.poll(() => offline.replies(root.id)).toEqual(replies);
});

// If this fails, a person cannot go back to an old message they followed a`],
]);
