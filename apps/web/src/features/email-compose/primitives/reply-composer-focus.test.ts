import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplyComposerFocus } from './reply-composer-focus';

const disposers: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement('div');
  const to = document.createElement('input');
  const body = document.createElement('div');
  const editorInput = document.createElement('input');
  body.append(editorInput);
  container.append(to, body);
  document.body.append(container);
  const editor = { focus: vi.fn(() => editorInput.focus()) };
  const expandRecipients = vi.fn();
  return createRoot((dispose) => {
    disposers.push(dispose);
    const focus = createReplyComposerFocus({
      editor: () => editor,
      container: () => container,
      footer: () => undefined,
      scrollContainer: () => body,
      toInput: () => to,
      expandRecipients,
    });
    return { dispose, focus, editor, to, editorInput, expandRecipients };
  });
}

describe('reply focus lifetime', () => {
  it('holds forward focus through editor reconciliation until deliberate interaction', () => {
    const state = setup();
    state.focus.forward();
    expect(state.expandRecipients).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(state.to);
    state.editorInput.focus();
    expect(document.activeElement).toBe(state.to);
    document.dispatchEvent(new Event('pointerdown'));
    state.editorInput.focus();
    expect(document.activeElement).toBe(state.editorInput);
  });

  it('cancels queued focus and removes the forward focus guard on disposal', () => {
    const state = setup();
    const onFocused = vi.fn();
    state.focus.forward();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(state.to);
    state.focus.forward();
    state.focus.reply();
    state.focus.editor(onFocused);
    state.dispose();
    state.editorInput.focus();
    expect(document.activeElement).toBe(state.editorInput);
    vi.runAllTimers();
    expect(state.editor.focus).not.toHaveBeenCalled();
    expect(onFocused).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(state.to);
  });

  it('disarms forward focus when keyboard navigation or outside focus takes over', () => {
    const state = setup();
    state.focus.forward();
    vi.advanceTimersByTime(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    state.editorInput.focus();
    expect(document.activeElement).toBe(state.editorInput);
    state.focus.forward();
    vi.advanceTimersByTime(100);
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    state.editorInput.focus();
    expect(document.activeElement).toBe(state.editorInput);
  });
});
