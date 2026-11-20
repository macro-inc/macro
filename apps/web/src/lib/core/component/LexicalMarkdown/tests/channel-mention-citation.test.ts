/**
 * @vitest-environment jsdom
 */

import type { ChannelLookup } from '@queries/channel/directory';
import { directoryChannel } from '@queries/channel/tests/directory-channel';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const CHANNEL_ID = '0193a7c4-0000-7000-8000-000000000001';

const directory = vi.hoisted(() => ({
  lookup: (_id: string): ChannelLookup => ({ status: 'pending' }),
}));
vi.mock('@core/context/channels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/context/channels')>()),
  useChannelDirectory: () => ({ lookup: (id: string) => directory.lookup(id) }),
}));

import { replaceCitations } from '../citationsUtils';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function replaceUnderOwner(input: string) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return replaceCitations(input);
  });
}

it('names a channel mention once a cold directory finds the channel', async () => {
  const [lookup, setLookup] = createSignal<ChannelLookup>({
    status: 'pending',
  });
  directory.lookup = () => lookup();

  const replaced = replaceUnderOwner(`See [[channel-mention;${CHANNEL_ID}]]`);
  setLookup({
    status: 'loaded',
    channel: directoryChannel(CHANNEL_ID, { name: 'design' }),
  });

  expect(await replaced).toBe(
    `See <m-document-mention>${JSON.stringify({
      documentId: CHANNEL_ID,
      blockName: 'channel',
      documentName: 'design',
      blockParams: {},
    })}</m-document-mention>`
  );
});

it('leaves a channel the viewer has not joined unnamed', async () => {
  directory.lookup = () => ({ status: 'missing' });

  expect(
    await replaceUnderOwner(`[[channel-mention;${CHANNEL_ID}]]`)
  ).toContain('"documentName":""');
});
