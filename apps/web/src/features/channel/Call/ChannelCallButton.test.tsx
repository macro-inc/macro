/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { ComponentProps, JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelCallButton,
  SLIDE_TO_CALL_DISTANCE_PX,
} from './ChannelCallButton';

const mocks = vi.hoisted(() => ({
  touch: false,
  inChannel: false,
  joining: false,
  activeCall: null as { id: string } | null,
  joinCall: vi.fn<() => Promise<void>>(),
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn() },
}));

vi.mock('@channel/Channel/ChannelTabContext', () => ({
  useChannelTab: () => ({ setActiveTab: vi.fn() }),
}));

vi.mock('@core/mobile/haptics', () => ({
  hapticImpact: vi.fn(),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));

vi.mock('@queries/call/call', () => ({
  useActiveCallQuery: () => ({ data: mocks.activeCall }),
}));

vi.mock('./use-call', () => ({
  useCall: () => ({
    isJoining: () => mocks.joining,
    isInThisChannel: () => mocks.inChannel,
    joinCall: mocks.joinCall,
  }),
}));

vi.mock('@ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui')>();
  type ButtonProps = ComponentProps<'button'> & {
    tooltip?: string;
    children?: JSX.Element;
  };
  const Button = (props: ButtonProps) => (
    <button
      type="button"
      aria-label={props.tooltip}
      disabled={props.disabled}
      class={props.class}
      style={props.style}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onKeyDown={props.onKeyDown}
    >
      {props.children}
    </button>
  );
  return { ...actual, Button };
});

function renderButton() {
  return render(() => <ChannelCallButton channelId="channel-1" />);
}

function callButton() {
  return screen.getByRole('button');
}

function slide(
  button: HTMLElement,
  distance: number,
  options?: { release?: boolean }
) {
  fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientY: 40 });
  fireEvent.pointerMove(button, {
    pointerId: 1,
    clientY: 40 + distance,
  });
  if (options?.release === false) return;
  fireEvent.pointerUp(button, {
    pointerId: 1,
    clientY: 40 + distance,
  });
}

beforeEach(() => {
  mocks.touch = false;
  mocks.inChannel = false;
  mocks.joining = false;
  mocks.activeCall = null;
  mocks.joinCall.mockReset();
  mocks.joinCall.mockResolvedValue();

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

describe('ChannelCallButton', () => {
  it('starts a call on click on desktop', async () => {
    renderButton();

    fireEvent.click(callButton());

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
    expect(screen.queryByTestId('call-slide-track')).toBeNull();
  });

  it('does not start a call on tap on touch, and reveals the slide track', () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    expect(screen.getByTestId('call-slide-track').dataset.visible).toBe(
      'false'
    );

    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerUp(button, { pointerId: 1, clientY: 40 });

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-slide-track').dataset.visible).toBe('true');
    expect(
      screen.getByRole('status', {
        name: 'Slide the call button down to start the call',
      })
    ).toBeTruthy();
  });

  it('starts a call after sliding down about an inch', async () => {
    mocks.touch = true;
    renderButton();

    slide(callButton(), SLIDE_TO_CALL_DISTANCE_PX);

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });

  it('keeps the track visible after a short drag that does not complete the slide', () => {
    mocks.touch = true;
    renderButton();

    slide(callButton(), 40);

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(screen.getByTestId('call-slide-track').dataset.visible).toBe('true');
  });
});
