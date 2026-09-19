import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript';

const session = vi.hoisted(() => ({
  messages: () => [] as FoldedMessage[],
  quoteSelection: vi.fn(),
  touch: false,
  top: () => 40,
  bottom: (): number => 80,
}));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => session,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ contentOffsetTop: session.top }),
}));
vi.mock('@components/app/mobile/float-regions/float-region-state', () => ({
  FloatRegions: { hostHeight: () => session.bottom() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => session.touch,
}));
vi.mock('@ui', () => ({ cn: (...classes: string[]) => classes.join(' ') }));
vi.mock('./AgentMessage', () => ({
  Message: (props: { message: FoldedMessage }) => (
    <span data-message={`${props.message.turn}:${props.message.author.kind}`}>
      {JSON.stringify(props.message.parts)}
    </span>
  ),
}));
vi.mock('./ReplyToSelection', () => ({
  ReplyToSelection: (props: {
    container?: HTMLElement;
    onReply: (text: string) => void;
  }) => (
    <button
      data-selection-connected={!!props.container}
      onClick={() => props.onReply('selected text')}
    >
      Reply to selection
    </button>
  ),
}));

const message = (turn: number, text = 'hello'): FoldedMessage =>
  ({
    agentSessionId: 'session',
    turn,
    author: { kind: 'agent' },
    parts: [{ kind: 'text', text }],
    stop: null,
  }) as FoldedMessage;

// Keep the real ThreadList/Solid adapter/core. Only browser geometry and the
// expensive message renderer are substituted; jsdom has no layout engine.
let viewport = 400;
let rowHeight = 96;
const originalScrollTo = HTMLElement.prototype.scrollTo;
const observers = new Set<{
  callback: ResizeObserverCallback;
  elements: Set<Element>;
}>();
const resize = () => {
  for (const observer of observers) {
    observer.callback(
      [...observer.elements].map((target) => ({
        target,
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
        borderBoxSize: [
          { inlineSize: 800, blockSize: (target as HTMLElement).offsetHeight },
        ],
        contentRect: target.getBoundingClientRect(),
      })),
      {} as ResizeObserver
    );
  }
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 40));
};

beforeEach(() => {
  viewport = 400;
  rowHeight = 96;
  session.touch = false;
  session.bottom = () => 80;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      elements = new Set<Element>();
      constructor(public callback: ResizeObserverCallback) {
        observers.add(this);
      }
      observe(element: Element) {
        observers.add(this);
        this.elements.add(element);
      }
      unobserve(element: Element) {
        this.elements.delete(element);
      }
      disconnect() {
        this.elements.clear();
        observers.delete(this);
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-index') ? rowHeight : viewport;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    () => viewport
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return Math.max(
        viewport,
        Number.parseFloat(
          (this.firstElementChild as HTMLElement)?.style.height
        ) || 0
      );
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return {
        width: 800,
        height: this.offsetHeight,
        top: 0,
        left: 0,
        bottom: this.offsetHeight,
        right: 800,
        x: 0,
        y: 0,
        toJSON() {},
      };
    }
  );
  HTMLElement.prototype.scrollTo = function (
    options: ScrollToOptions | number = {}
  ) {
    const top = typeof options === 'number' ? options : (options.top ?? 0);
    this.scrollTop = Math.max(
      0,
      Math.min(top, this.scrollHeight - this.clientHeight)
    );
    this.dispatchEvent(new Event('scroll'));
  };
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollTo = originalScrollTo;
  window.getSelection()?.removeAllRanges();
});

function mount(initial: FoldedMessage[]) {
  const [messages, setMessages] = createSignal(initial);
  session.messages = messages;
  const view = render(() => <Transcript />);
  const scroller = view.container.querySelector<HTMLDivElement>(
    '[data-channel-scroll]'
  )!;
  return { ...view, scroller, setMessages };
}

describe('Transcript with the shared TanStack ThreadList', () => {
  it('reveals the overlay on downward thumb drag and refreshes the unpinned thumb range', async () => {
    const view = mount(Array.from({ length: 50 }, (_, i) => message(i)));
    await settle();
    view.scroller.scrollTo({ top: 500 });
    await settle();
    const gutter = view.scroller.nextElementSibling as HTMLElement;
    const thumb = gutter.firstElementChild as HTMLElement;
    let captured = false;
    gutter.setPointerCapture = () => {
      captured = true;
    };
    gutter.hasPointerCapture = () => captured;
    gutter.releasePointerCapture = () => {
      captured = false;
    };
    const pointer = (type: string, clientY: number) =>
      gutter.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientY,
        })
      );
    const thumbTop = Number.parseFloat(
      thumb.style.transform.slice('translateY('.length)
    );
    pointer('pointerdown', thumbTop + 2);
    pointer('pointermove', thumbTop + 22);
    // jsdom does not dispatch scroll events for direct scrollTop assignments.
    view.scroller.dispatchEvent(new Event('scroll'));
    pointer('pointerup', thumbTop + 22);
    await settle();
    expect(view.getByText('Scroll to bottom')).toBeTruthy();

    const offset = view.scroller.scrollTop;
    const oldHeight = Number.parseFloat(thumb.style.height);
    const sizer = view.scroller.firstElementChild!;
    expect(
      [...observers].some((observer) => observer.elements.has(sizer))
    ).toBe(true);
    // Change only the sizer style, without row mutations or a scroll event.
    (sizer as HTMLElement).style.height =
      `${view.scroller.scrollHeight + 2000}px`;
    resize();
    await settle();
    expect(view.scroller.scrollTop).toBe(offset);
    expect(Number.parseFloat(thumb.style.height)).toBeLessThan(oldHeight);
  });

  it('loads asynchronous history at latest with only a bounded range mounted', async () => {
    const view = mount([]);
    await settle();
    view.setMessages(Array.from({ length: 200 }, (_, i) => message(i)));
    await settle();
    expect(
      view.container.querySelector('[data-message="199:agent"]')
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-message]').length
    ).toBeLessThan(30);
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);
  });

  it('bottom-aligns a short transcript inside mobile insets and preserves selection wiring', async () => {
    session.touch = true;
    const view = mount([message(0)]);
    await settle();
    const row = view.container.querySelector<HTMLElement>('[data-index="0"]')!;
    expect(row.style.transform).toBe('translateY(224px)');
    expect(view.scroller.scrollTop).toBe(0);
    const reply = view.getByText('Reply to selection');
    expect(reply.getAttribute('data-selection-connected')).toBe('true');
    reply.click();
    expect(session.quoteSelection).toHaveBeenCalledWith('selected text');
  });

  it('uses the channel header inset without a fixed-pixel decorative gap', async () => {
    session.touch = true;
    rowHeight = 500;
    const view = mount([message(0)]);
    await settle();
    resize();
    await settle();
    const row = view.container.querySelector<HTMLElement>('[data-index="0"]')!;
    expect(row.style.transform).toBe('translateY(40px)');
    expect(view.scroller.scrollHeight).toBe(40 + 500 + 80);
  });

  it('keeps a mounted row and its selection when its message object is replaced', async () => {
    const view = mount([message(0)]);
    await settle();
    const row = view.container.querySelector('[data-index]');
    const text = view.container.querySelector('[data-message]')!;
    const range = document.createRange();
    range.selectNode(text);
    window.getSelection()!.addRange(range);
    view.setMessages([message(0, 'streamed text'), message(1)]);
    await settle();
    expect(view.container.querySelector('[data-index]')).toBe(row);
    expect(view.container.querySelector('[data-message]')).toBe(text);
    expect(text.textContent).toContain('streamed text');
    expect(window.getSelection()!.containsNode(text, true)).toBe(true);
    view.setMessages([]);
    await settle();
    expect(view.container.querySelector('[data-message]')).toBeNull();
  });

  it('renders in-place reconciled parts updates without remounting the message', async () => {
    const [messages, setMessages] = createStore([message(0, 'first token')]);
    session.messages = () => messages;
    const view = render(() => <Transcript />);
    await settle();
    const originalMessage = messages[0];
    const originalParts = messages[0].parts;
    const originalPart = messages[0].parts[0];
    const row = view.container.querySelector('[data-index]');
    const text = view.container.querySelector('[data-message]');

    // The feed reconciles at an existing array index, not by replacing its
    // accessor or message object. Nested store reads must remain subscribed.
    setMessages(0, reconcile(message(0, 'first token and more')));
    await settle();
    expect(messages[0]).toBe(originalMessage);
    expect(messages[0].parts).toBe(originalParts);
    expect(messages[0].parts[0]).toBe(originalPart);
    expect(view.container.querySelector('[data-index]')).toBe(row);
    expect(view.container.querySelector('[data-message]')).toBe(text);
    expect(text?.textContent).toContain('first token and more');

    const next = message(0, 'finished text');
    next.parts.push({ kind: 'text', text: 'a newly streamed part' });
    setMessages(0, reconcile(next));
    await settle();
    expect(view.container.querySelector('[data-index]')).toBe(row);
    expect(view.container.querySelector('[data-message]')).toBe(text);
    expect(text?.textContent).toContain('finished text');
    expect(text?.textContent).toContain('a newly streamed part');
  });

  it('follows appends and measured streaming growth only while pinned', async () => {
    const view = mount(Array.from({ length: 30 }, (_, i) => message(i)));
    await settle();
    view.setMessages((list) => [...list, message(30)]);
    await settle();
    rowHeight = 140;
    resize();
    await settle();
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);

    view.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -600 }));
    view.scroller.scrollTo({ top: 500 });
    await settle();
    const offset = view.scroller.scrollTop;
    view.setMessages((list) => [...list, message(31)]);
    await settle();
    expect(view.scroller.scrollTop).toBe(offset);
    expect(view.scroller.scrollTop).toBeLessThan(
      view.scroller.scrollHeight - viewport - 50
    );
  });

  it('keeps the end pin through keyboard squish and floating composer inset changes', async () => {
    session.touch = true;
    const [bottom, setBottom] = createSignal(80);
    session.bottom = bottom;
    const view = mount(Array.from({ length: 30 }, (_, i) => message(i)));
    await settle();
    viewport = 250;
    resize();
    await settle();
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);
    setBottom(160);
    await settle();
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);
    view.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -600 }));
    view.scroller.scrollTo({ top: 500 });
    await settle();
    const offset = view.scroller.scrollTop;
    setBottom(200);
    viewport = 400;
    resize();
    await settle();
    expect(view.scroller.scrollTop).toBe(offset);
  });

  it('reveals the shared overlay on downward intent and resumes following on click', async () => {
    const view = mount(Array.from({ length: 50 }, (_, i) => message(i)));
    await settle();
    view.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -600 }));
    view.scroller.scrollTo({ top: 500 });
    await settle();
    expect(view.queryByText('Scroll to bottom')).toBeNull();
    view.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    view.scroller.scrollTo({ top: 600 });
    await settle();
    view.getByText('Scroll to bottom').click();
    await settle();
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);
    expect(view.queryByText('Scroll to bottom')).toBeNull();
    view.setMessages((list) => [...list, message(50)]);
    await settle();
    expect(view.scroller.scrollTop).toBe(view.scroller.scrollHeight - viewport);
  });
});
