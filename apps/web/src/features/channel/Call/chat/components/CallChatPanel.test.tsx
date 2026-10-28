/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallChatPanel } from './CallChatPanel';

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
      disconnect() {
        if (this.chat) disconnect();
      }
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('preserves the draft and content nodes when closing and reopening', () => {
  const [open, setOpen] = createSignal(true);
  render(() => (
    <CallChatPanel
      id="chat"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </CallChatPanel>
  ));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Unsent draft' } });
  const panel = screen.getByRole('complementary', { name: 'Call chat' });
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
    <CallChatPanel id="chat" open onClose={() => {}} composer={null}>
      <p>Messages</p>
    </CallChatPanel>
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
    <CallChatPanel
      id="phone-chat"
      open={open()}
      onClose={() => setOpen(false)}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </CallChatPanel>
  ));
  const panel = screen.getByRole('dialog', { name: 'Call chat' });
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
    <CallChatPanel
      id="responsive-chat"
      open
      onClose={() => {}}
      composer={<input aria-label="Message" />}
    >
      <p>Earlier message</p>
    </CallChatPanel>
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
    screen.getByRole('dialog', { name: 'Call chat' }).contains(input)
  ).toBe(true);
  expect(screen.getByRole('textbox')).toBe(input);
  resize();
  expect(viewport.scrollTop).toBe(300);
  setMobile(false);
  expect(
    screen.getByRole('complementary', { name: 'Call chat' }).contains(input)
  ).toBe(true);
  expect(input.value).toBe('Draft across rotation');
  expect(viewport.scrollTop).toBe(300);
});
