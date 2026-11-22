/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type BodyPopupSlot, buttonSlot, promptSlot } from './body-popup-slots';
import { NativeBodyToolbar } from './native-body-toolbar';

// The native body popup's toolbar against Source MarkdownPopupToolbar
// (MarkdownPopup.tsx:621-810): selection actions first with one divider,
// a prompt that replaces the whole toolbar at its measured width, and two
// exits (submit hides the popup; Escape returns to the toolbar).

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 321, height: 32 })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function aiSlot(available = () => true) {
  const capture = vi.fn(() => 'captured-ai');
  const seen: string[] = [];
  const slot = promptSlot<string>({
    id: 'ai',
    available,
    button: (control) => (
      <button type="button" onClick={() => control.open()}>
        AI edit
      </button>
    ),
    capture,
    prompt: (control) => {
      seen.push(control.value);
      return (
        <div>
          <span>AI prompt</span>
          <button type="button" onClick={() => control.close()}>
            Submit AI
          </button>
          <button type="button" onClick={() => control.dismiss()}>
            Dismiss AI
          </button>
        </div>
      );
    },
  });
  return { slot, capture, seen };
}

function taskSlot(onTask: () => void, available = () => true) {
  return buttonSlot({
    id: 'task',
    available,
    button: (control) => (
      <button
        type="button"
        onClick={() => {
          onTask();
          control.close();
        }}
      >
        Task
      </button>
    ),
  });
}

function linkSlot() {
  return promptSlot<string>({
    id: 'link',
    available: () => true,
    capture: () => 'captured-link',
    prompt: (control) => <span>Link prompt {control.value}</span>,
  });
}

function mount(
  slots: readonly BodyPopupSlot[],
  options: { interactable?: () => boolean } = {}
) {
  const hide = vi.fn();
  const focusEditor = vi.fn();
  render(() => (
    <NativeBodyToolbar
      slots={slots}
      interactable={options.interactable ?? (() => true)}
      formatTools={(requestLink) => (
        <button type="button" onClick={requestLink}>
          Link
        </button>
      )}
      hide={hide}
      focusEditor={focusEditor}
    />
  ));
  return { hide, focusEditor };
}

const order = () =>
  [...screen.getByRole('toolbar').querySelectorAll('button, [role=separator]')]
    .map((node) =>
      node.getAttribute('role') === 'separator' ? '|' : node.textContent
    )
    .join(' ');

test('available slot buttons come first, then one divider, then FormatTools', () => {
  mount([aiSlot().slot, taskSlot(vi.fn())]);
  expect(order()).toBe('AI edit Task | Link');
});

test('no divider when no selection action is available', () => {
  mount([aiSlot(() => false).slot, taskSlot(vi.fn(), () => false)]);
  expect(order()).toBe('Link');
});

test('selection actions show without formatting interactability', () => {
  // Source keeps the divider after them (:706-713): the comment and
  // snippet-link actions always follow.
  mount([taskSlot(vi.fn())], { interactable: () => false });
  expect(order()).toBe('Task |');
});

test('opening a prompt captures first and replaces the toolbar at its measured width', () => {
  const ai = aiSlot();
  mount([ai.slot]);
  fireEvent.click(screen.getByText('AI edit'));
  expect(ai.capture).toHaveBeenCalledTimes(1);
  expect(ai.seen).toEqual(['captured-ai']);
  expect(screen.getByText('AI prompt')).toBeTruthy();
  expect(screen.queryByText('AI edit')).toBeNull();
  expect(screen.queryByText('Link')).toBeNull();
  expect(screen.getByRole('toolbar').style.width).toBe('321px');
});

test('dismiss returns to the toolbar and refocuses the editor without hiding', () => {
  const { hide, focusEditor } = mount([aiSlot().slot]);
  fireEvent.click(screen.getByText('AI edit'));
  fireEvent.click(screen.getByText('Dismiss AI'));
  expect(screen.getByText('AI edit')).toBeTruthy();
  expect(screen.queryByText('AI prompt')).toBeNull();
  expect(focusEditor).toHaveBeenCalledTimes(1);
  expect(hide).not.toHaveBeenCalled();
});

test('dismissing any prompt notifies every slot (Source dismissPrompt clears all inputs)', () => {
  const dismissed: string[] = [];
  const watched = (id: 'ai' | 'link') =>
    promptSlot<string>({
      id,
      available: () => true,
      button: (control) => (
        <button type="button" onClick={() => control.open()}>
          Open {id}
        </button>
      ),
      capture: () => id,
      prompt: (control) => (
        <button type="button" onClick={() => control.dismiss()}>
          Dismiss {control.value}
        </button>
      ),
      dismissed: () => dismissed.push(id),
    });
  mount([watched('ai'), watched('link')]);
  fireEvent.click(screen.getByText('Open link'));
  fireEvent.click(screen.getByText('Dismiss link'));
  expect(dismissed).toEqual(['ai', 'link']);
});

test('close leaves the prompt and hides the popup', () => {
  const { hide } = mount([aiSlot().slot]);
  fireEvent.click(screen.getByText('AI edit'));
  fireEvent.click(screen.getByText('Submit AI'));
  expect(hide).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('AI prompt')).toBeNull();
});

test('a button-only slot hides the popup and never opens a prompt', () => {
  const onTask = vi.fn();
  const { hide } = mount([taskSlot(onTask)]);
  fireEvent.click(screen.getByText('Task'));
  expect(onTask).toHaveBeenCalledTimes(1);
  expect(hide).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Task')).toBeTruthy();
});

test('FormatTools opens the link prompt with its captured value', () => {
  mount([linkSlot()]);
  fireEvent.click(screen.getByText('Link'));
  expect(screen.getByText('Link prompt captured-link')).toBeTruthy();
});

test('slot availability is read reactively', () => {
  const [available, setAvailable] = createSignal(false);
  mount([aiSlot(available).slot]);
  expect(order()).toBe('Link');
  setAvailable(true);
  expect(order()).toBe('AI edit | Link');
});

test('two slots with one id are a programming error', () => {
  expect(() => mount([aiSlot().slot, aiSlot().slot])).toThrow(
    'Duplicate body popup slot id: ai'
  );
});
