/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelCallButton } from '../ChannelCallButton';
import { SLIDE_TO_CALL_DISTANCE_PX } from '../slide-down-call';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent);

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

vi.mock('../call-tabs', () => ({
  getCallJoinTab: () => 'call',
  getCallLeaveTab: () => 'messages',
}));

vi.mock('../use-call', () => ({
  useCall: () => ({
    isJoining: () => mocks.joining,
    isInThisChannel: () => mocks.inChannel,
    joinCall: mocks.joinCall,
  }),
}));

vi.mock('@ui', () => {
  type ButtonProps = {
    tooltip?: string;
    'aria-label'?: string;
    disabled?: boolean;
    children?: JSX.Element;
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
    onKeyDown?: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent>;
  };
  const Button = (props: ButtonProps) => (
    <button
      type="button"
      aria-label={props['aria-label'] ?? props.tooltip}
      disabled={props.disabled}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
    >
      {props.children}
    </button>
  );
  return {
    Button,
    cn: (...classes: Array<string | false | null | undefined>) =>
      classes.filter(Boolean).join(' '),
  };
});

function renderButton() {
  return render(() => <ChannelCallButton channelId="channel-1" />);
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: PointerEventInit
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      ...init,
    })
  );
}

function slideFrom(button: HTMLElement, distance: number) {
  dispatchPointer(button, 'pointerdown', { clientY: 40 });
  dispatchPointer(window, 'pointermove', { clientY: 40 + distance });
  dispatchPointer(window, 'pointerup', { clientY: 40 + distance });
}

beforeEach(() => {
  mocks.touch = false;
  mocks.inChannel = false;
  mocks.joining = false;
  mocks.activeCall = null;
  mocks.joinCall.mockReset();
  mocks.joinCall.mockResolvedValue();
});

describe('ChannelCallButton', () => {
  it('starts a call on click on desktop', async () => {
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }));

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });

  it('does not start a call on click on touch', () => {
    mocks.touch = true;
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Slide down to call' }));

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Slide the call button down to start the call')
    ).toBeNull();
  });

  it('reveals the slide track after a tap that does not complete the gesture', () => {
    mocks.touch = true;
    renderButton();

    const button = screen.getByRole('button', { name: 'Slide down to call' });
    dispatchPointer(button, 'pointerdown', { clientY: 40 });
    dispatchPointer(window, 'pointerup', { clientY: 40 });

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(
      screen.getByText('Slide the call button down to start the call')
    ).toBeTruthy();
  });

  it('starts a call after sliding down about an inch', async () => {
    mocks.touch = true;
    renderButton();

    slideFrom(
      screen.getByRole('button', { name: 'Slide down to call' }),
      SLIDE_TO_CALL_DISTANCE_PX
    );

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });
});
