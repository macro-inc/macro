/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallChatBody } from './CallChatBody';
import { CallChatPanel } from './CallChatPanel';

function TestCallPanel(props: {
  id: string;
  open: boolean;
  onClose: () => void;
  composer: JSX.Element;
  children: JSX.Element;
  sidebarMount?: HTMLElement;
  overlayMount?: HTMLElement;
}) {
  const [tab, setTab] = createSignal<'chat' | 'participants'>('chat');
  return (
    <CallChatPanel
      id={props.id}
      open={props.open}
      onClose={props.onClose}
      activeTab={tab()}
      onTabChange={setTab}
      chatAvailable
      participantCount={1}
      participants={<p>Participant list</p>}
      sidebarMount={props.sidebarMount}
      overlayMount={props.overlayMount}
    >
      <CallChatBody
        open={props.open && tab() === 'chat'}
        composer={props.composer}
      >
        {props.children}
      </CallChatBody>
    </CallChatPanel>
  );
}

const layout = vi.hoisted(() => ({ mobile: (): boolean => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => layout.mobile() }));
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  layout.mobile = () => false;
  vi.stubGlobal('scrollTo', vi.fn());
  disconnect.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private callback: () => void;
      private chat = false;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        if (target.hasAttribute('data-channel-scroll')) {
          resize = this.callback;
          this.chat = true;
        }
      }
      unobserve() {}
      disconnect() {
        if (this.chat) disconnect();
      }
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('preserves the draft and content nodes when closing and reopening', () => {
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="chat"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </TestCallPanel>
  ));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Unsent draft' } });
  const panel = screen.getByRole('complementary', { name: 'Call sidebar' });
  setOpen(false);
  expect(panel.hidden).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  setOpen(true);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('Unsent draft');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(panel.hidden).toBe(true);
});

it('follows new messages at the bottom without jumping while reading history', () => {
  const result = render(() => (
    <TestCallPanel id="chat" open onClose={() => {}} composer={null}>
      <p>Messages</p>
    </TestCallPanel>
  ));
  const content = screen.getByText('Messages').parentElement!;
  const viewport = content.parentElement!;
  let height = 1000;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 200 },
  });
  resize();
  expect(viewport.scrollTop).toBe(1000);
  viewport.scrollTop = 300;
  fireEvent.scroll(viewport);
  height = 1200;
  resize();
  expect(viewport.scrollTop).toBe(300);
  viewport.scrollTop = 1000;
  fireEvent.scroll(viewport);
  height = 1400;
  resize();
  expect(viewport.scrollTop).toBe(1400);
  result.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('dismisses the phone sheet with Escape and keeps its draft on reopen', async () => {
  layout.mobile = () => true;
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="phone-chat"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </TestCallPanel>
  ));
  const panel = screen.getByRole('dialog', { name: 'Call sidebar' });
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Unsent phone draft' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(open()).toBe(false));
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  setOpen(true);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('Unsent phone draft');
});

it('keeps the editor and history position when switching between sheet and sidebar', () => {
  const [mobile, setMobile] = createSignal(false);
  layout.mobile = mobile;
  render(() => (
    <TestCallPanel
      id="responsive-chat"
      open
      onClose={() => {}}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </TestCallPanel>
  ));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const viewport =
    screen.getByText('Earlier message').parentElement!.parentElement!;
  Object.defineProperties(viewport, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 200 },
  });
  viewport.scrollTop = 300;
  fireEvent.scroll(viewport);
  fireEvent.input(input, { target: { value: 'Draft across rotation' } });
  setMobile(true);
  expect(
    screen.getByRole('dialog', { name: 'Call sidebar' }).contains(input)
  ).toBe(true);
  expect(screen.getByRole('textbox')).toBe(input);
  resize();
  expect(viewport.scrollTop).toBe(300);
  setMobile(false);
  expect(
    screen.getByRole('complementary', { name: 'Call sidebar' }).contains(input)
  ).toBe(true);
  expect(input.value).toBe('Draft across rotation');
  expect(viewport.scrollTop).toBe(300);
});

it.each([false, true])(
  'keeps the draft and history across tab switches (phone: %s)',
  (mobile) => {
    layout.mobile = () => mobile;
    render(() => (
      <TestCallPanel
        id="tabs"
        open
        onClose={() => {}}
        composer={<input aria-label="Message" />}
      >
        <p>Messages</p>
      </TestCallPanel>
    ));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const viewport = screen.getByText('Messages').parentElement!.parentElement!;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
    fireEvent.input(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('tab', { name: /Participants/ }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(input.isConnected).toBe(true);
    resize();
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Keep this draft');
    expect(viewport.scrollTop).toBe(300);
  }
);

it('moves the same sidebar and editor between docked and overlay hosts', () => {
  const [docked, setDocked] = createSignal(true);
  let sidebar!: HTMLDivElement;
  let overlay!: HTMLDivElement;
  render(() => (
    <>
      <div ref={sidebar} />
      <div ref={overlay} />
      <TestCallPanel
        id="docking"
        open
        onClose={() => {}}
        sidebarMount={docked() ? sidebar : undefined}
        overlayMount={overlay}
        composer={<input aria-label="Message" />}
      >
        <p>Messages</p>
      </TestCallPanel>
    </>
  ));
  const panel = screen.getByRole('complementary', { name: 'Call sidebar' });
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Keep during resize' } });
  expect(panel.parentElement).toBe(sidebar);
  setDocked(false);
  expect(panel.parentElement).toBe(overlay);
  expect(screen.getByRole('textbox')).toBe(input);
  setDocked(true);
  expect(panel.parentElement).toBe(sidebar);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('Keep during resize');
});

function fakeDrawerFrames(duration = '0.2s') {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-corvu-drawer-content') ? 400 : 0;
    }
  );
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const getComputedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const styles = getComputedStyle(element);
    if (!element.hasAttribute('data-corvu-drawer-content')) return styles;
    return new Proxy(styles, {
      get(target, property) {
        if (property === 'transitionDuration') return duration;
        return Reflect.get(target, property, target);
      },
    });
  });
  return () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(0);
  };
}

it('ignores an opening frame after a rapid close and completes a motionless close', () => {
  layout.mobile = () => true;
  const frame = fakeDrawerFrames();
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="rapid-close"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Messages</p>
    </TestCallPanel>
  ));
  const sheet = document.querySelector<HTMLElement>(
    '[data-corvu-drawer-content]'
  )!;
  setOpen(false);
  frame();
  frame();
  expect(sheet.hasAttribute('data-opening')).toBe(false);
  expect(sheet.hasAttribute('data-closing')).toBe(false);
  expect(sheet.getAttribute('data-closed')).not.toBeNull();
});

it('reopens during a close without a stale frame or transition closing the sheet or replacing chat nodes', () => {
  layout.mobile = () => true;
  const frame = fakeDrawerFrames();
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="reopen"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Messages</p>
    </TestCallPanel>
  ));
  const sheet = document.querySelector<HTMLElement>(
    '[data-corvu-drawer-content]'
  )!;
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Retained draft' } });
  frame();
  frame();
  fireEvent.transitionEnd(sheet);
  setOpen(false);
  frame();
  setOpen(true);
  frame();
  fireEvent.transitionEnd(sheet);
  expect(sheet.getAttribute('data-closed')).toBeNull();
  expect(sheet.hasAttribute('data-closing')).toBe(true);
  frame();
  expect(sheet.hasAttribute('data-closing')).toBe(false);
  expect(sheet.getAttribute('data-closed')).toBeNull();
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('Retained draft');
});

it('ignores deferred drawer work after disposal', () => {
  layout.mobile = () => true;
  const frame = fakeDrawerFrames();
  const [open, setOpen] = createSignal(true);
  const result = render(() => (
    <TestCallPanel
      id="dispose"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Messages</p>
    </TestCallPanel>
  ));
  setOpen(false);
  result.unmount();
  expect(() => {
    frame();
    frame();
  }).not.toThrow();
  expect(document.querySelector('[data-corvu-drawer-content]')).toBeNull();
});

it('waits for transitionend on an animated close', () => {
  layout.mobile = () => true;
  const frame = fakeDrawerFrames();
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="animated"
      open={open()}
      onClose={() => setOpen(false)}
      composer={null}
    >
      <p>Messages</p>
    </TestCallPanel>
  ));
  const sheet = document.querySelector<HTMLElement>(
    '[data-corvu-drawer-content]'
  )!;
  frame();
  frame();
  setOpen(false);
  frame();
  frame();
  expect(sheet.hasAttribute('data-closing')).toBe(true);
  expect(sheet.getAttribute('data-closed')).toBeNull();
  fireEvent.transitionEnd(sheet);
  expect(sheet.getAttribute('data-closed')).not.toBeNull();
});

it('completes a zero-duration close without transitionend', () => {
  layout.mobile = () => true;
  const frame = fakeDrawerFrames('0s');
  const [open, setOpen] = createSignal(true);
  render(() => (
    <TestCallPanel
      id="instant"
      open={open()}
      onClose={() => setOpen(false)}
      composer={null}
    >
      <p>Messages</p>
    </TestCallPanel>
  ));
  const sheet = document.querySelector<HTMLElement>(
    '[data-corvu-drawer-content]'
  )!;
  frame();
  frame();
  setOpen(false);
  frame();
  frame();
  expect(sheet.hasAttribute('data-closing')).toBe(false);
  expect(sheet.getAttribute('data-closed')).not.toBeNull();
});

it.each([300, 400])(
  'finishes a drag close at %spx without truncating its animation',
  (distance) => {
    layout.mobile = () => true;
    const frame = fakeDrawerFrames();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <TestCallPanel
        id="drag-close"
        open={open()}
        onClose={() => setOpen(false)}
        composer={null}
      >
        <p>Messages</p>
      </TestCallPanel>
    ));
    const sheet = document.querySelector<HTMLElement>(
      '[data-corvu-drawer-content]'
    )!;
    frame();
    frame();
    fireEvent.transitionEnd(sheet);
    for (const [type, y] of [
      ['pointerdown', 0],
      ['pointermove', 1],
      ['pointermove', distance + 1],
      ['pointerup', distance + 1],
    ] as const) {
      sheet.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0, clientY: y })
      );
    }
    expect(open()).toBe(false);
    frame();
    frame();
    if (distance === 300) {
      expect(sheet.hasAttribute('data-closing')).toBe(true);
      expect(sheet.getAttribute('data-closed')).toBeNull();
      fireEvent.transitionEnd(sheet);
    }
    expect(sheet.getAttribute('data-closed')).not.toBeNull();
  }
);
