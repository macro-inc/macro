import type { Api, SentMessage } from './harness/api';
import { expectShown, shown, type Named } from './harness/device';
import { test } from './harness/fixtures';
import { Conversation } from './harness/messages';
import { goOffline, goOnline } from './harness/network';
import { serverChannel } from './harness/server';

type Scene = { channel: Named; messages: SentMessage[] };
async function scene(ada: Api, ben: Api): Promise<Scene> {
  const channel = await ada.createChannel({ members: [ben.person] });
  const messages = [
    await ada.post(channel.id, 'one'),
    await ada.post(channel.id, 'two'),
    await ben.post(channel.id, 'three'),
  ];
  return { channel, messages };
}

async function watch(label: string, views: [string, Conversation][], channel: Named, ms: number) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < ms) {
    const parts: string[] = [];
    for (const [name, view] of views) parts.push(`${name}=${JSON.stringify(await shown(view))}`);
    parts.push(`server=${JSON.stringify(await serverChannel('ada', channel.id))}`);
    const now = parts.join(' | ');
    if (now !== last) {
      console.log(`ZZ ${label} +${Date.now() - t0}ms ${now}`);
      last = now;
    }
    await views[0][1].page.waitForTimeout(100);
  }
}

test('ZZ-13 two devices', async ({ pageFor, ada, ben }) => {
  const { channel, messages } = await scene(ada, ben);
  const laptop = new Conversation(await pageFor('ben'), channel.id);
  await laptop.open();
  const phone = new Conversation(await pageFor('ben'), channel.id);
  await phone.open();
  await expectShown(phone, ['one', 'two', 'three']);
  phone.page.on('console', (m) => { const t = m.text(); if (t.startsWith('DBG')) console.log(`ZZ phone-console ${t}`); });
  await goOffline(phone.page.context());
  await phone.send('from the phone');
  await phone.quickReact(phone.messageById(messages[0].id), '👍');
  await laptop.send('from the laptop');
  await laptop.action(laptop.messageById(messages[2].id), 'edit');
  await laptop.retype('three, edited on the laptop');
  await laptop.page.keyboard.press('Enter');
  await ada.post(channel.id, 'from ada');
  await watch('13-offline', [['phone', phone], ['laptop', laptop]], channel, 1500);
  await goOnline(phone.page.context());
  await watch('13-online', [['phone', phone], ['laptop', laptop]], channel, 15000);
});

test('ZZ-12 two windows', async ({ pageFor, ada, ben }) => {
  const { channel } = await scene(ada, ben);
  const first = await pageFor('ben');
  const one = new Conversation(first, channel.id);
  await one.open();
  const two = new Conversation(await first.context().newPage(), channel.id);
  await two.open();
  await expectShown(two, ['one', 'two', 'three']);
  for (const [n, p] of [['one', one.page], ['two', two.page]] as const) p.on('console', (m) => { const t = m.text(); if (t.startsWith('DBG')) console.log(`ZZ ${n}-console ${t}`); });
  await goOffline(first.context());
  await first.bringToFront();
  await one.send('from the first window');
  await two.page.bringToFront();
  await two.send('from the second window');
  await watch('12-offline', [['one', one], ['two', two]], channel, 1500);
  await goOnline(first.context());
  await watch('12-online', [['one', one], ['two', two]], channel, 15000);
});

test('ZZ-20 online send latency', async ({ pageFor, ada, ben }) => {
  const { channel } = await scene(ada, ben);
  const laptop = new Conversation(await pageFor('ben'), channel.id);
  laptop.page.on('console', (m) => { const t = m.text(); if (t.startsWith('DBGq')) console.log("ZZ w" + test.info().parallelIndex + " " + t); });
  await laptop.open();
  await expectShown(laptop, ['one', 'two', 'three']);
  for (let i = 0; i < 6; i += 1) {
    const text = `send ${i}`;
    await laptop.send(text);
    const t0 = Date.now();
    while (!(await serverChannel('ada', channel.id)).includes(text)) {
      if (Date.now() - t0 > 30_000) break;
      await laptop.page.waitForTimeout(25);
    }
    console.log("ZZ w" + test.info().parallelIndex + " latency " + i + " " + (Date.now() - t0) + "ms");
    if (i === 2) await laptop.page.waitForTimeout(4000);
  }
});

test('ZZ-14 other window', async ({ pageFor, ada, ben }) => {
  const { channel } = await scene(ada, ben);
  const first = await pageFor('ben');
  const one = new Conversation(first, channel.id);
  await one.open();
  const two = new Conversation(await first.context().newPage(), channel.id);
  await two.open();
  await expectShown(two, ['one', 'two', 'three']);
  for (const [n, p] of [['one', one.page], ['two', two.page]] as const)
    p.on('console', (m) => { const t = m.text(); if (t.startsWith('DBG')) console.log(`ZZ ${n}-console ${t}`); });
  await goOffline(first.context());
  await two.send('from the second window');
  await watch('14', [['one', one], ['two', two]], channel, 8000);
});
