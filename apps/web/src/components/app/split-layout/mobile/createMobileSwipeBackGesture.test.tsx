import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SwipableRow, SwipableRowProvider } from '../../mobile/SwipableRow';
import type { MobilePaneStack } from './createMobilePaneStack';
import { createMobileSwipeBackGesture } from './createMobileSwipeBackGesture';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: () => {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(200);
  // Row drags paint on the next frame. Run that frame now so a test can see
  // whether the message moved.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function touch(target: Element, type: string, x?: number, y = 20) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = x === undefined ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
  return event;
}

function Harness(props: { stack: MobilePaneStack }) {
  const gesture = createMobileSwipeBackGesture({
    animationMs: 88,
    bgPeekOffset: 110,
    edgeThreshold: 40,
    velocityThreshold: 0.3,
    distanceThreshold: 0.5,
    stack: props.stack,
    canStart: () => true,
  });
  const [container, setContainer] = createSignal<HTMLElement>();

  return (
    <SwipableRowProvider container={container} triggerBehavior="spring-back">
      <div
        data-testid="host"
        on:touchstart={gesture.handleTouchStart}
        on:touchmove={gesture.handleTouchMove}
        on:touchend={gesture.handleTouchEnd}
        on:touchcancel={gesture.handleTouchCancel}
      >
        <div data-testid="pane" style={gesture.styleForSlot(true)} />
        <div data-swipe-back-region ref={setContainer}>
          <SwipableRow id="message" onSwipeLeft={() => {}}>
            <div>Hello</div>
          </SwipableRow>
          <button type="button">Show replies</button>
          <a href="/notes">notes</a>
          <div data-testid="code" style={{ 'overflow-x': 'auto' }}>
            code
          </div>
          <div data-testid="scroller" data-swipe-back-scroll>
            <p>History</p>
          </div>
          <input data-testid="field" />
          <div contenteditable="true" data-testid="editor">
            draft
          </div>
        </div>
        <div data-testid="composer">
          <button type="button">Send</button>
        </div>
      </div>
    </SwipableRowProvider>
  );
}

function renderChannel(canGoBack = true) {
  const completeGoBack = vi.fn();
  const stack: MobilePaneStack = {
    front: () => undefined,
    behind: () => undefined,
    canGoBack: () => canGoBack,
    completeGoBack,
    setAnimatedTrigger: () => {},
    setForwardTrigger: () => {},
    goBack: () => {},
  };
  render(() => <Harness stack={stack} />);
  return { completeGoBack };
}

function pane() {
  return screen.getByTestId('pane');
}

function messageContent() {
  return screen
    .getByText('Hello')
    .closest<HTMLElement>('[data-swipe-content]')!;
}

it('slides back from a rightward drag anywhere in the message list', () => {
  const { completeGoBack } = renderChannel();
  const message = screen.getByText('Hello');

  touch(message, 'touchstart', 100);
  const move = touch(message, 'touchmove', 230);

  expect(move.defaultPrevented).toBe(true);
  expect(pane().style.transform).toBe('translateX(130px)');
  expect(messageContent().style.transform).toBe('');

  touch(message, 'touchend');
  expect(completeGoBack).not.toHaveBeenCalled();
  vi.advanceTimersByTime(88);
  expect(completeGoBack).toHaveBeenCalledOnce();
});

it('snaps back when the rightward drag is short', () => {
  const { completeGoBack } = renderChannel();
  const message = screen.getByText('Hello');

  touch(message, 'touchstart', 80);
  touch(message, 'touchmove', 130);
  touch(message, 'touchend');

  expect(pane().style.transform).toBe('translateX(0px)');
  expect(completeGoBack).not.toHaveBeenCalled();
});

it('keeps vertical scrolling and leftward reply swipes', () => {
  const { completeGoBack } = renderChannel();
  const message = screen.getByText('Hello');

  touch(message, 'touchstart', 140, 30);
  const vertical = touch(message, 'touchmove', 148, 90);
  expect(vertical.defaultPrevented).toBe(false);
  expect(pane().style.transform).toBe('translateX(0px)');

  touch(message, 'touchend');
  touch(message, 'touchstart', 280);
  const left = touch(message, 'touchmove', 200);

  expect(left.defaultPrevented).toBe(true);
  expect(pane().style.transform).toBe('translateX(0px)');
  expect(messageContent().style.transform).toBe('translateX(-80px)');
  touch(message, 'touchend');
  vi.advanceTimersByTime(88);
  expect(completeGoBack).not.toHaveBeenCalled();
});

it('swipes back from a message control or link', () => {
  renderChannel();

  const replies = screen.getByRole('button', { name: 'Show replies' });
  touch(replies, 'touchstart', 90);
  touch(replies, 'touchmove', 170);
  expect(pane().style.transform).toBe('translateX(80px)');

  touch(replies, 'touchend');
  vi.advanceTimersByTime(88);
  const link = screen.getByRole('link', { name: 'notes' });
  touch(link, 'touchstart', 60);
  touch(link, 'touchmove', 150);
  expect(pane().style.transform).toBe('translateX(90px)');
});

it('leaves the composer and text fields alone', () => {
  renderChannel();
  const cases = [
    screen.getByTestId('composer'),
    screen.getByTestId('field'),
    screen.getByTestId('editor'),
  ];
  for (const target of cases) {
    touch(target, 'touchstart', 100);
    const move = touch(target, 'touchmove', 220);
    expect(move.defaultPrevented).toBe(false);
    expect(pane().style.transform).toBe('translateX(0px)');
    touch(target, 'touchend');
  }
});

it('goes back on a code block at its start, and scrolls one already panned', () => {
  renderChannel();
  const code = screen.getByTestId('code');
  Object.defineProperty(code, 'scrollWidth', { value: 800 });

  touch(code, 'touchstart', 80);
  touch(code, 'touchmove', 200);
  expect(pane().style.transform).toBe('translateX(120px)');
  touch(code, 'touchend');
  vi.advanceTimersByTime(88);

  Object.defineProperty(code, 'scrollLeft', { value: 40 });
  touch(code, 'touchstart', 80);
  const move = touch(code, 'touchmove', 200);
  expect(move.defaultPrevented).toBe(false);
  expect(pane().style.transform).toBe('translateX(0px)');
});

it('still swipes back across the message list scroller', () => {
  renderChannel();
  const scroller = screen.getByTestId('scroller');
  Object.defineProperty(scroller, 'scrollWidth', { value: 900 });
  scroller.style.overflowX = 'auto';

  const history = screen.getByText('History');
  touch(history, 'touchstart', 70);
  touch(history, 'touchmove', 190);
  expect(pane().style.transform).toBe('translateX(120px)');
});

it('still swipes back from the left edge outside the message list', () => {
  renderChannel();
  const composer = screen.getByTestId('composer');

  touch(composer, 'touchstart', 12);
  const move = touch(composer, 'touchmove', 40);
  expect(move.defaultPrevented).toBe(true);
  expect(pane().style.transform).toBe('translateX(28px)');
});

it('does not take the edge swipe from a button outside the message list', () => {
  renderChannel();
  const send = screen.getByRole('button', { name: 'Send' });

  touch(send, 'touchstart', 12);
  const move = touch(send, 'touchmove', 80);
  expect(move.defaultPrevented).toBe(false);
  expect(pane().style.transform).toBe('translateX(0px)');
});

it('does nothing when there is no previous view', () => {
  renderChannel(false);
  const message = screen.getByText('Hello');

  touch(message, 'touchstart', 80);
  const move = touch(message, 'touchmove', 200);

  expect(move.defaultPrevented).toBe(false);
  expect(pane().style.transform).toBe('translateX(0px)');
  expect(messageContent().style.transform).toBe('');
});
