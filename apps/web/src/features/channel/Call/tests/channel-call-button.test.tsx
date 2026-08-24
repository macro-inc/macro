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

function callButton() {
  return screen.getByRole('button', { name: 'Start Call' });
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

/** The live region is always mounted; only its text changes. */
function hintText() {
  return screen.getByRole('status').textContent;
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

    fireEvent.click(callButton());

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });

  it('does not start a call on click on touch', () => {
    mocks.touch = true;
    renderButton();

    fireEvent.click(callButton());

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(hintText()).toBe('');
  });

  it('shows the slide hint only while the knob is held', () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { clientY: 40 });
    expect(hintText()).toBe('Slide the call button down to call');

    dispatchPointer(window, 'pointerup', { clientY: 40 });

    expect(mocks.joinCall).not.toHaveBeenCalled();
    // Letting go puts the slot away immediately rather than leaving a hint up.
    expect(hintText()).toBe('');
  });

  it('starts a call after sliding down about an inch', async () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { clientY: 40 });
    dispatchPointer(window, 'pointermove', {
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });
    expect(hintText()).toBe('Release to call');

    dispatchPointer(window, 'pointerup', {
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });

  it('does not start a call when the slide is dragged back above the threshold', () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { clientY: 40 });
    dispatchPointer(window, 'pointermove', {
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });
    dispatchPointer(window, 'pointermove', { clientY: 60 });
    dispatchPointer(window, 'pointerup', { clientY: 60 });

    expect(mocks.joinCall).not.toHaveBeenCalled();
  });

  it('abandons the slide when the pointer swings sideways', () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { clientX: 200, clientY: 40 });
    dispatchPointer(window, 'pointermove', { clientX: 120, clientY: 60 });
    dispatchPointer(window, 'pointerup', {
      clientX: 120,
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });

    expect(mocks.joinCall).not.toHaveBeenCalled();
  });

  it('resets cleanly when the gesture is cancelled', () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { clientY: 40 });
    dispatchPointer(window, 'pointermove', {
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });
    dispatchPointer(window, 'pointercancel', {
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });

    expect(mocks.joinCall).not.toHaveBeenCalled();
    expect(hintText()).toBe('');
  });

  it('ignores a second pointer landing mid-slide', async () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    dispatchPointer(button, 'pointerdown', { pointerId: 1, clientY: 40 });
    dispatchPointer(button, 'pointerdown', { pointerId: 2, clientY: 40 });
    dispatchPointer(window, 'pointerup', { pointerId: 2, clientY: 40 });

    expect(mocks.joinCall).not.toHaveBeenCalled();

    // The original gesture is still live and can still place the call.
    dispatchPointer(window, 'pointermove', {
      pointerId: 1,
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });
    dispatchPointer(window, 'pointerup', {
      pointerId: 1,
      clientY: 40 + SLIDE_TO_CALL_DISTANCE_PX,
    });

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });

  it('places one call per keypress and ignores auto-repeat', async () => {
    mocks.touch = true;
    renderButton();

    const button = callButton();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    fireEvent.keyDown(button, { key: 'Enter', repeat: true });

    await waitFor(() => {
      expect(mocks.joinCall).toHaveBeenCalledOnce();
    });
  });
});
