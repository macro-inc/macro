import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachNavigationGuard } from './navigation-guard';

/** A window for the frame's page, from a real (jsdom) frame. */
function pageWindow(): Window {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  if (!frame.contentWindow) throw new Error('jsdom gave the frame no window');
  return frame.contentWindow;
}

/**
 * A frame whose window the test replaces, as a browser does when the
 * frame's element is detached and reattached (jsdom keeps the window).
 */
function movableFrame() {
  const target = new EventTarget();
  return Object.assign(target, { contentWindow: pageWindow() });
}

const load = (frame: EventTarget) => frame.dispatchEvent(new Event('load'));

describe('attachNavigationGuard', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('leaves on a second load in the same window', () => {
    const frame = movableFrame();
    const onLeave = vi.fn();
    attachNavigationGuard(frame, { token: 't', onLeave });

    load(frame);
    expect(onLeave).not.toHaveBeenCalled();
    load(frame);
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('treats a load in a new window, after the frame moved, as a fresh start', () => {
    const frame = movableFrame();
    const onLeave = vi.fn();
    attachNavigationGuard(frame, { token: 't', onLeave });
    load(frame);

    frame.contentWindow = pageWindow();
    load(frame);
    expect(onLeave).not.toHaveBeenCalled();

    // A navigation after the move still closes the page.
    load(frame);
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('leaves when the page reports leaving with its token, from its own window', () => {
    const frame = movableFrame();
    const onLeave = vi.fn();
    attachNavigationGuard(frame, { token: 't', onLeave });
    const send = (data: unknown, source: Window | null) =>
      window.dispatchEvent(new MessageEvent('message', { data, source }));

    send({ type: 'macro:leaving', token: 'other' }, frame.contentWindow);
    send({ type: 'macro:leaving', token: 't' }, window);
    expect(onLeave).not.toHaveBeenCalled();

    send({ type: 'macro:leaving', token: 't' }, frame.contentWindow);
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
