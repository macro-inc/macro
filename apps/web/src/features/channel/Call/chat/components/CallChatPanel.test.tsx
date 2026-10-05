/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallChatPanel } from './CallChatPanel';

let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
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
