import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markMessageSent, messageSendMotion } from './message-send-motion';

function Message(props: { id: string | undefined }) {
  return <div ref={(el) => messageSendMotion(el, () => props.id)}>Message</div>;
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

  it('does not wake unrelated message observers on a send', () => {
    const { animate } = setup();
    const historyId = vi.fn(() => 'unrelated-history');
    render(() => (
      <>
        <div ref={(el) => messageSendMotion(el, historyId)} />
        <Message id="independent-send" />
      </>
    ));
    expect(historyId).toHaveBeenCalled();
    historyId.mockClear();

    markMessageSent('independent-send');

    expect(animate).toHaveBeenCalledOnce();
    expect(historyId).not.toHaveBeenCalled();
  });

  it('handles a message ID arriving after its send marker', () => {
    const { animate } = setup();
    const [id, setId] = createSignal<string>();
    render(() => <Message id={id()} />);
    markMessageSent('resolved-id');
    expect(animate).not.toHaveBeenCalled();

    setId('resolved-id');
    expect(animate).toHaveBeenCalledOnce();

    setId('another-id');
    setId('resolved-id');
    expect(animate).toHaveBeenCalledOnce();
  });

  it('consumes a send once when the same message is mounted in two splits', () => {
    const { animate } = setup();
    render(() => <Message id="shared-message" />);
    render(() => <Message id="shared-message" />);

    markMessageSent('shared-message');

    expect(animate).toHaveBeenCalledOnce();
  });

  it('slides without scaling and cancels on unmount', () => {
    const { animate, cancel } = setup();
    markMessageSent('channel');
    const view = render(() => <Message id="channel" />);
    expect(animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('respects reduced motion and consumes the entrance', () => {
    const { animate } = setup(true);
    markMessageSent('reduced');
    const view = render(() => <Message id="reduced" />);
    expect(animate).not.toHaveBeenCalled();

    view.unmount();
    const { animate: afterPreferenceChange } = setup(false);
    render(() => <Message id="reduced" />);
    expect(afterPreferenceChange).not.toHaveBeenCalled();
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
