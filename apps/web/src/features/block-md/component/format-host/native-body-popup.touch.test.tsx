/** @vitest-environment jsdom */
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buttonSlot, promptSlot } from './body-popup-slots';
import type { NativeBodyTouchActions } from './native-body-popup';
import type { BodyFormattingPopupHost, DocumentFormattingHost } from './types';

// The native body popup's touch branch against Source MarkdownPopup's
// PopupToolbar on touch: Source's own TouchSelectionToolbar in a
// GeneralizedPopup, shown after the popup's 100 ms visibility lag, the iOS
// edit menu suppressed while the popup is visible, and each option wired to
// its native action.

const edit = vi.hoisted(() => ({ suppressed: [] as boolean[] }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/nativeEditMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mobile/nativeEditMenu')>()),
  setNativeEditMenuSuppressed: (suppressed: boolean) =>
    edit.suppressed.push(suppressed),
}));

const { NativeBodyFormatPopup } = await import('./native-body-popup');

const offsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
);
beforeEach(() => {
  vi.useFakeTimers();
  edit.suppressed.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // jsdom has no layout: every option measures one width, all on one page.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 40,
  });
  vi.stubGlobal('innerWidth', 4000);
});
afterEach(() => {
  const failures: unknown[] = [];
  for (const release of [
    cleanup,
    () => document.body.replaceChildren(),
    () => {
      if (offsetWidth)
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetWidth',
          offsetWidth
        );
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
    },
    () => {
      vi.unstubAllGlobals();
    },
    () => {
      vi.useRealTimers();
    },
  ])
    try {
      release();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length > 0) throw failures[0];
});

function mount(
  options: {
    canComment?: boolean;
    threads?: boolean;
    table?: boolean;
    task?: boolean;
    /** The Task slot's Source label; undefined models a slot without one. */
    taskLabel?: string | null;
    converting?: boolean;
  } = {}
) {
  const scope = document.createElement('div');
  scope.className = 'portal-scope';
  scope.dataset.blockContent = '';
  const root = document.createElement('div');
  scope.append(root);
  document.body.append(scope);
  let popup: { visible(value: boolean): boolean } | undefined;
  const host: DocumentFormattingHost = {
    selection: () => undefined,
    focused: () => true,
    editable: () => true,
    interactable: () => true,
    root: () => root,
    focus: vi.fn(),
    formatText: vi.fn(),
    formatBlock: vi.fn(),
    requestLink: vi.fn(),
    unlink: vi.fn(),
  };
  const bodyPopup: BodyFormattingPopupHost = {
    rectangle: () => DOMRect.fromRect({ x: 10, y: 10, width: 80, height: 16 }),
    registerPopup: (callbacks) => {
      popup = callbacks;
    },
    registerListeners: () => {},
  };
  const calls: string[] = [];
  const touch: NativeBodyTouchActions = {
    documentId: () => 'doc-1',
    canComment: () => options.canComment ?? false,
    insertComment: (hide) => {
      calls.push('insertComment');
      hide();
    },
    openComment: {
      available: () => options.threads ?? false,
      open: (hide) => {
        calls.push('openComment');
        hide();
      },
    },
    share: () => ({
      copied: () => false,
      copy: async () => {
        calls.push('share');
      },
    }),
    table: {
      available: () => options.table ?? false,
      convert: () => {
        calls.push('table');
        return true;
      },
    },
    paste: async (hide) => {
      calls.push('paste');
      hide();
    },
  };
  const ai = promptSlot<undefined>({
    id: 'ai',
    available: () => true,
    button: () => <button type="button">AI edit</button>,
    capture: () => undefined,
    prompt: () => null,
    select: (hide) => {
      calls.push('ai');
      hide();
    },
  });
  const task = buttonSlot({
    id: 'task',
    available: () => options.task ?? false,
    button: () => <button type="button">Task</button>,
    select: (hide) => {
      calls.push('task');
      hide();
    },
    touchLabel:
      options.taskLabel === null
        ? undefined
        : () => options.taskLabel ?? 'Task',
    converting: () => options.converting ?? false,
  });
  const [closed, setClosed] = createSignal(0);
  render(() => (
    <FloatingMenuGroup>
      <NativeBodyFormatPopup
        host={host}
        popup={bodyPopup}
        slots={[ai, task]}
        touch={touch}
        onToolbarClosed={() => setClosed(closed() + 1)}
      />
    </FloatingMenuGroup>
  ));
  const show = (value: boolean) => {
    if (!popup) throw new Error('Popup did not register');
    popup.visible(value);
  };
  return { show, calls, closed };
}

/** The touch toolbar's visible page, not its hidden measuring row. */
const options = () =>
  screen
    .queryAllByRole('button')
    .filter(
      (button) =>
        !button.closest('[aria-hidden="true"], [inert]') &&
        !['Previous options', 'More options'].includes(
          button.getAttribute('aria-label') ?? ''
        )
    )
    .map((button) => button.textContent?.trim());

test('the touch toolbar shows after the 100 ms visibility lag, in Source order', () => {
  const { show } = mount();
  show(true);
  expect(options()).toEqual([]);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual(['Copy', 'Cut', 'Share', 'Edit with AI']);
});

test('every capability: Show comment, Task, Table, Copy, Cut, Comment, Share, Edit with AI', () => {
  const { show } = mount({
    canComment: true,
    threads: true,
    table: true,
    task: true,
  });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual([
    'Show comment',
    'Task',
    'Table',
    'Copy',
    'Cut',
    'Comment',
    'Share',
    'Edit with AI',
  ]);
});

test('the iOS edit menu is suppressed while the popup is visible', () => {
  const { show } = mount();
  show(true);
  expect(edit.suppressed.at(-1)).toBe(true);
  show(false);
  expect(edit.suppressed.at(-1)).toBe(false);
});

test('Edit with AI runs the AI slot touch action and hides the popup', () => {
  const { show, calls, closed } = mount();
  show(true);
  vi.advanceTimersByTime(100);
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
  expect(calls).toEqual(['ai']);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual([]);
  expect(closed()).toBe(1);
});

test('each option reaches its native action', async () => {
  const { show, calls } = mount({
    canComment: true,
    threads: true,
    table: true,
    task: true,
  });
  for (const name of ['Show comment', 'Task', 'Table', 'Comment', 'Share']) {
    show(true);
    vi.advanceTimersByTime(100);
    fireEvent.click(screen.getByRole('button', { name }));
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(calls).toEqual([
    'openComment',
    'task',
    'table',
    'insertComment',
    'share',
  ]);
});

test("the Task option uses the slot's exact Source label and converting state", () => {
  const { show } = mount({
    task: true,
    taskLabel: 'Converting...',
    converting: true,
  });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toContain('Converting...');
  expect(options()).not.toContain('Task');
});

test('a Task slot without a Source label is not offered on touch (C-TOUCH-TASK-LABEL-01)', () => {
  const { show } = mount({ task: true, taskLabel: null });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual(['Copy', 'Cut', 'Share', 'Edit with AI']);
});
