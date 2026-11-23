/**
 * @vitest-environment jsdom
 */

import { ChannelDirectoryProvider } from '@core/context/channels';
import {
  type ChannelDirectory,
  channelDirectoryState,
  lookupChannel,
} from '@queries/channel/directory';
import type { DirectoryChannel } from '@queries/channel/directory-core';
import { directoryChannel } from '@queries/channel/tests/directory-channel';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SectionChannelsPicker } from './SectionChannelsDialog';

const LABEL: ChannelLabel = {
  id: 'label',
  name: 'Section',
  channelCount: 1,
  channelIds: ['in-section'],
  createdAt: '2026-11-01T00:00:00+00:00',
  updatedAt: '2026-11-01T00:00:00+00:00',
  sortOrder: 0,
};

afterEach(cleanup);

/** A directory still filling, as on a cold cache. */
function coldDirectory(channels: readonly DirectoryChannel[]) {
  const [listed, setListed] = createSignal(channels);
  const state = () => channelDirectoryState(listed(), [], false);
  const directory: ChannelDirectory = {
    channels: () => state().joined,
    complete: () => false,
    lookup: (channelId) => lookupChannel(state(), {}, channelId),
    readComplete: () => new Promise(() => {}),
    failed: () => false,
    retry: () => {},
    recordView: () => {},
    viewsCurrent: () => true,
  };
  return { directory, setListed };
}

it('adds a channel chosen while the directory is still filling', async () => {
  const cold = coldDirectory([
    directoryChannel('in-section'),
    directoryChannel('listed'),
  ]);
  const onConfirm = vi.fn(async (_ids: string[]) => [] as string[]);
  const onClose = vi.fn();
  const view = render(() => (
    <ChannelDirectoryProvider directory={cold.directory}>
      <SectionChannelsPicker
        label={LABEL}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </ChannelDirectoryProvider>
  ));

  // What it has so far, already-assigned channels left out, and the rest
  // still loading.
  expect(view.queryByText('channel in-section')).toBeNull();
  expect(view.getByText('Loading channels…')).toBeTruthy();
  fireEvent.click(view.getByText('channel listed'));

  // A channel that arrives later is listed but not chosen.
  cold.setListed((channels) => [...channels, directoryChannel('late')]);
  expect(view.getByText('channel late')).toBeTruthy();

  fireEvent.click(view.getByRole('button', { name: 'Add 1 channel' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  // Additions only: what the viewer chose, never the unfinished rest.
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(['listed']);
});
