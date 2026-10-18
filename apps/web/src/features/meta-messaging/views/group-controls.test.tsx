import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: undefined as undefined | (() => void | Promise<void>),
  request: (_input: { id: string; discard: boolean }): Promise<string> =>
    Promise.reject(new Error('No request configured')),
  remove: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({}),
}));
// Keep route identities without starting unrelated app socket adapters in jsdom.
vi.mock('@app/routes/routes', () => ({
  channelDetailRoute: { id: 'channels-channel' },
  homeChannelRoute: { id: 'home-channel' },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  globalRemoveFromSplitHistory: mocks.remove,
}));
vi.mock('@ui', () => {
  const panel = (props: { children?: JSX.Element }) => props.children;
  return {
    Panel: Object.assign(panel, { Header: panel, Body: panel }),
    Button: (props: { children?: JSX.Element; onClick?: () => void }) => (
      <button onClick={props.onClick}>{props.children}</button>
    ),
    ConfirmDialog: (props: {
      open: boolean;
      onConfirm: () => void | Promise<void>;
    }) => {
      // The second dialog is the deletion confirmation.
      mocks.confirm = props.onConfirm;
      return null;
    },
    confirmDialog: vi.fn(),
  };
});
vi.mock('../queries/groups', () => ({
  useWhatsappGroup: () => {
    const idle = { error: null, isPending: false, isSuccess: false };
    return {
      group: () => ({
        status: 'active',
        participants: [],
        can_delete: true,
        can_copy_link: false,
      }),
      retry: idle,
      copy: idle,
      remove: idle,
      destroy: useMutation(() => ({
        retry: false,
        mutationFn: (input: { id: string; discard: boolean }) =>
          mocks.request(input),
      })),
    };
  },
}));

import { WhatsappGroupControls } from './group-controls';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([true, false])(
  'preserves the confirmed deletion outcome after Participants unmounts (success=%s)',
  async (succeeds) => {
    const response = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    mocks.request = (input) => {
      expect(input).toEqual({ id: 'deleted-channel', discard: false });
      started.resolve();
      return response.promise;
    };
    const client = new QueryClient();
    const view = render(() => (
      <QueryClientProvider client={client}>
        <WhatsappGroupControls channelId="deleted-channel" />
      </QueryClientProvider>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete WhatsApp group' })
    );
    const completed = mocks.confirm?.();
    await started.promise;
    view.unmount();
    expect(mocks.remove).not.toHaveBeenCalled();
    if (succeeds) response.resolve('deleted-channel');
    else response.reject(new Error('Deletion was not confirmed'));
    await completed;
    if (succeeds) {
      expect(mocks.remove).toHaveBeenCalledOnce();
      const matches = mocks.remove.mock.calls[0][1];
      expect(matches({ type: 'channel', id: 'deleted-channel' })).toBe(true);
      expect(matches({ type: 'channel', id: 'another-channel' })).toBe(false);
      for (const route of ['channels-channel', 'home-channel']) {
        expect(
          matches({
            type: 'component',
            id: route === 'home-channel' ? 'home' : 'channels',
            entryMetadata: {
              route: {
                matches: [
                  { id: route, params: { channelId: 'deleted-channel' } },
                ],
              },
            },
          })
        ).toBe(true);
      }
      expect(
        matches({
          type: 'component',
          id: 'channels',
          entryMetadata: {
            route: {
              matches: [
                {
                  id: 'channels-channel',
                  params: { channelId: 'another-channel' },
                },
              ],
            },
          },
        })
      ).toBe(false);
    } else {
      expect(mocks.remove).not.toHaveBeenCalled();
    }
    client.clear();
  }
);
