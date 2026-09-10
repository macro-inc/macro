import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markMessageSent, messageSendMotion } from './message-send-motion';

function Message(props: { id: string; kind?: 'bubble' | 'channel' }) {
  return (
    <div
      ref={(el) =>
        messageSendMotion(el, () => props.id, props.kind ?? 'bubble')
      }
    >
      Message
    </div>
  );
}

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'animate'
);

function setup(reduced = false) {
  const cancel = vi.fn();
  const animate = vi.fn<HTMLElement['animate']>(
    () => ({ cancel }) as unknown as Animation
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced }))
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  return { animate, cancel };
}

afterEach(() => {
  cleanup();
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local send motion', () => {
  it('leaves history still and animates a send once, including after a remount', () => {
    const { animate } = setup();
    const history = render(() => <Message id="history" />);
    expect(animate).not.toHaveBeenCalled();
    history.unmount();
    markMessageSent('new');
    const sent = render(() => <Message id="new" />);
    expect(animate).toHaveBeenCalledTimes(1);
    sent.unmount();
    render(() => <Message id="new" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('handles agent acknowledgements arriving after the message mounts', () => {
    const { animate } = setup();
    render(() => <Message id="agent-response" />);
    markMessageSent('agent-response');
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('uses a slide without scaling for channels and cancels on unmount', () => {
    const { animate, cancel } = setup();
    markMessageSent('channel');
    const view = render(() => <Message id="channel" kind="channel" />);
    expect(animate.mock.calls[0][0]).toEqual([
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ]);
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('respects reduced motion and consumes the entrance', () => {
    const { animate } = setup(true);
    markMessageSent('reduced');
    render(() => <Message id="reduced" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does not animate stale sends when returning to a conversation', () => {
    const { animate } = setup();
    vi.useFakeTimers();
    markMessageSent('stale');
    vi.advanceTimersByTime(6000);
    render(() => <Message id="stale" />);
    expect(animate).not.toHaveBeenCalled();
  });
});
