/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewCallButton } from './NewCallButton';

const mocks = vi.hoisted(() => ({
  joinChannelCall: vi.fn<(_: string) => Promise<void>>(),
}));

vi.mock('@channel/Call/join-channel-call', () => ({
  joinChannelCall: mocks.joinChannelCall,
}));

vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: (props: {
    setSelectedOptions: (options: Array<{ id: string }>) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.setSelectedOptions([{ id: 'channel-option' }])}
    >
      Choose channel
    </button>
  ),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({ all: () => [] }),
}));

vi.mock('@core/util/destination', () => ({
  getDestinationFromOptions: () => ({
    type: 'channel',
    id: 'channel-123',
  }),
}));

vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutateAsync: vi.fn() }),
  useGetOrCreatePrivateChannelMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@ui', () => {
  type ChildrenProps = { children?: JSX.Element };
  type ButtonProps = ChildrenProps & {
    disabled?: boolean;
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  };

  const Button = (props: ButtonProps) => (
    <button disabled={props.disabled} onClick={props.onClick} type="button">
      {props.children}
    </button>
  );
  const Dialog = (props: ChildrenProps) => <>{props.children}</>;
  Dialog.CloseButton = Button;
  Dialog.Title = (props: ChildrenProps) => <span>{props.children}</span>;

  return {
    Button,
    Dialog,
    Surface: (props: ChildrenProps) => <div>{props.children}</div>,
  };
});

beforeEach(() => {
  mocks.joinChannelCall.mockReset();
  mocks.joinChannelCall.mockResolvedValue();
});

describe('NewCallButton', () => {
  it('starts the selected channel through the mounted-channel call flow', async () => {
    render(() => <NewCallButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }));

    await waitFor(() => {
      expect(mocks.joinChannelCall).toHaveBeenCalledOnce();
      expect(mocks.joinChannelCall).toHaveBeenCalledWith('channel-123');
    });
  });
});
