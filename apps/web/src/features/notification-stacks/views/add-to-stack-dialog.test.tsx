import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationStacksProvider } from '../context/notification-stacks-context';
import { fakeStacksContext, rule, supportStack } from '../tests/stacks';
import { AddToStackDialog } from './add-to-stack-dialog';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

const BOTS = supportStack({
  id: 'stack-bots',
  name: 'Bots',
  capture: [rule({ kinds: ['reaction'] })],
  release: [],
});

const setup = (channelName?: string) => {
  const fake = fakeStacksContext({
    t: 'ready',
    stacks: [supportStack(), BOTS],
  });
  render(() => (
    <NotificationStacksProvider value={fake.context}>
      <AddToStackDialog
        open
        onOpenChange={() => {}}
        channelId="channel-1"
        channelName={channelName}
      />
    </NotificationStacksProvider>
  ));
  return fake;
};

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('adding a channel to a stack', () => {
  it('says which stacks already capture the channel by its name', async () => {
    setup('Customer Support');
    await screen.findByRole('dialog');

    expect(
      screen.getAllByText('Already captures this channel by its name')
    ).toHaveLength(1);
    const support = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Support channels/,
    });
    // The stack does not list the channel, so its box stays clear.
    expect(support.checked).toBe(false);
  });

  it('never matches a direct message by name', async () => {
    setup();
    await screen.findByRole('dialog');

    expect(
      screen.queryByText('Already captures this channel by its name')
    ).toBeNull();
  });

  it('lists the channel in the stack the reader ticks, keeping its other rules', async () => {
    const { stacks } = setup('engineering');
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Bots' }));

    await waitFor(() =>
      expect(stacks.update).toHaveBeenCalledWith('stack-bots', {
        capture: [
          rule({
            sources: [{ type: 'channel', id: 'channel-1' }],
            kinds: ['reaction'],
          }),
        ],
      })
    );
  });
});
