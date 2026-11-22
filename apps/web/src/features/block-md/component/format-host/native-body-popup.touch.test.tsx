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

const edit = vi.hoisted(() => ({ suppressed: [] as boolean[], ios: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/util/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/util/platform')>();
  const platform = () => (edit.ios ? 'ios' : actual.getPlatform());
  return {
    ...actual,
    getPlatform: platform,
    isPlatform: (target: Parameters<typeof actual.isPlatform>[0]) =>
      (Array.isArray(target) ? target : [target]).includes(platform()),
  };
});
vi.mock('@core/mobile/nativeEditMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mobile/nativeEditMenu')>()),
  setNativeEditMenuSuppressed: (suppressed: boolean) =>
    edit.suppressed.push(suppressed),
}));

const { NativeBodyFormatPopup } = await import('./native-body-popup');
const { MarkdownDocumentProvider } = await import(
  '../../context/markdown-document-context'
);
const { createMarkdownDocumentState } = await import(
  '../../context/markdown-document-state'
);
const { mobileBodyFormatPopup } = await import(
  '../../views/mobile/body-format-popup'
);
const { desktopBodyFormatPopup } = await import(
  '../../views/body-format-popup'
);

const offsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
);
beforeEach(() => {
  vi.useFakeTimers();
  edit.suppressed.length = 0;
  edit.ios = false;
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
    /** The controller's model-derived selection text; '' for a caret or a
     *  zero-text range (Source MarkdownPopup :849). */
    text?: string;
    canEdit?: boolean;
    /** The entry's composition; this file's touch toolbar by default. */
    composition?: 'desktop' | 'touch';
    /** A live device choice, as the entries' isTouchDevice() signal is. */
    device?: () => 'desktop' | 'touch';
  } = {}
) {
  const scope = document.createElement('div');
  scope.className = 'portal-scope';
  scope.dataset.blockContent = '';
  const root = document.createElement('div');
  scope.append(root);
  document.body.append(scope);
  let popup: { visible(value: boolean): boolean } | undefined;
  let registrations = 0;
  const host: DocumentFormattingHost = {
    selection: () => undefined,
    focused: () => true,
    editable: () => true,
    interactable: () => options.canEdit ?? true,
    root: () => root,
    focus: vi.fn(),
    formatText: vi.fn(),
    formatBlock: vi.fn(),
    requestLink: vi.fn(),
    unlink: vi.fn(),
  };
  const bodyPopup: BodyFormattingPopupHost = {
    rectangle: () => DOMRect.fromRect({ x: 10, y: 10, width: 80, height: 16 }),
    selectionText: () => options.text ?? 'Select this phrase',
    captureLink: () => ({ insert: vi.fn() }),
    registerPopup: (callbacks) => {
      registrations++;
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
  const documentState = createMarkdownDocumentState();
  const composition = () =>
    (options.device?.() ?? options.composition) === 'desktop'
      ? desktopBodyFormatPopup
      : mobileBodyFormatPopup;
  const rendered = render(() => (
    <MarkdownDocumentProvider
      context={{
        documentId: () => 'doc-1',
        kind: () => 'document',
        documentSource: () => ({ type: 'loading' }),
        permissions: {
          canEdit: () => options.canEdit ?? true,
          canComment: () => options.canComment ?? false,
          isOwner: () => true,
        },
        persistedName: () => undefined,
        fallbackName: () => undefined,
        bodyFormatPopup: composition,
        state: documentState,
        element: () => root,
      }}
    >
      <FloatingMenuGroup>
        <NativeBodyFormatPopup
          composition={composition()}
          host={host}
          popup={bodyPopup}
          slots={[ai, task]}
          touch={touch}
          onToolbarClosed={() => setClosed(closed() + 1)}
        />
      </FloatingMenuGroup>
    </MarkdownDocumentProvider>
  ));
  const show = (value: boolean) => {
    if (!popup) throw new Error('Popup did not register');
    popup.visible(value);
  };
  return {
    show,
    calls,
    closed,
    unmount: rendered.unmount,
    registrations: () => registrations,
  };
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

/** Whether a toolbar element renders at all, and how many options it shows,
 *  as caret-mode.source-controls.test.tsx records for Source. */
function toolbar() {
  return {
    rendered: document.querySelector('.z-action-menu') !== null,
    options: options().length,
    suppressed: edit.suppressed.at(-1) ?? false,
  };
}

// C-TOUCH-CARET-MODE-01: an empty-text selection the controller admitted
// (a caret, or a zero-text range, in a comment) gets Source's caret options
// only. Expected values are the Source control's literal facts.

test('caret mode with a highlighted thread shows only Show comment', () => {
  const { show } = mount({ text: '', threads: true, canComment: true });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual(['Show comment']);
  expect(toolbar()).toEqual({ rendered: true, options: 1, suppressed: true });
});

test('caret mode on iOS with Edit adds Paste', () => {
  edit.ios = true;
  const { show } = mount({ text: '', threads: true });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual(['Show comment', 'Paste']);
  expect(edit.suppressed.at(-1)).toBe(true);
});

test('caret mode on iOS read-only keeps suppression and offers no Paste', () => {
  edit.ios = true;
  const { show } = mount({ text: '', threads: true, canEdit: false });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toEqual(['Show comment']);
  expect(edit.suppressed.at(-1)).toBe(true);
});

test('caret mode at an id-less mark: no Show comment, the same pill as Source', () => {
  const rows = [];
  for (const [row, ios, canEdit] of [
    ['android, edit', false, true],
    ['android, read-only', false, false],
    ['iOS, edit', true, true],
    ['iOS, read-only', true, false],
  ] as const) {
    cleanup();
    document.body.replaceChildren();
    edit.ios = ios;
    edit.suppressed.length = 0;
    const { show } = mount({ text: '', threads: false, canEdit });
    show(true);
    vi.advanceTimersByTime(100);
    rows.push({ row, labels: options(), ...toolbar() });
  }
  expect(rows).toEqual([
    {
      row: 'android, edit',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
    {
      row: 'android, read-only',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
    {
      row: 'iOS, edit',
      labels: ['Paste'],
      rendered: true,
      options: 1,
      suppressed: true,
    },
    {
      row: 'iOS, read-only',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
  ]);
});

test('Paste in caret mode reaches the native paste action', async () => {
  edit.ios = true;
  const { show, calls } = mount({ text: '', threads: false });
  show(true);
  vi.advanceTimersByTime(100);
  fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
  await vi.advanceTimersByTimeAsync(100);
  expect(calls).toEqual(['paste']);
});

// FE-70: the view entry picks one composition; the popup never shows both.
test('the desktop composition renders only the desktop toolbar, even with touch actions', () => {
  const { show } = mount({ composition: 'desktop' });
  show(true);
  vi.advanceTimersByTime(100);
  const shown = options();
  expect(shown).toContain('AI edit');
  expect(shown).not.toContain('Copy');
  expect(shown).not.toContain('Share');
});

test('the touch composition renders only TouchSelectionToolbar', () => {
  const { show } = mount();
  show(true);
  vi.advanceTimersByTime(100);
  const shown = options();
  expect(shown).toContain('Copy');
  expect(shown).not.toContain('AI edit');
});

test.each(['desktop', 'touch'] as const)(
  'unmounting the %s popup closes its toolbar and releases the iOS edit menu',
  (composition) => {
    const { show, closed, unmount } = mount({ composition });
    show(true);
    vi.advanceTimersByTime(100);
    expect(closed()).toBe(0);
    unmount();
    expect(closed()).toBe(1);
    expect(edit.suppressed.at(-1)).toBe(false);
    expect(document.querySelector('[data-popup], .z-action-menu')).toBeNull();
  }
);

test('a live device flip swaps the toolbar without remounting the popup shell', () => {
  const [device, setDevice] = createSignal<'desktop' | 'touch'>('desktop');
  const { show, closed, registrations } = mount({ device });
  show(true);
  vi.advanceTimersByTime(100);
  expect(options()).toContain('AI edit');
  expect(options()).not.toContain('Copy');
  setDevice('touch');
  vi.advanceTimersByTime(100);
  expect(options()).toContain('Copy');
  expect(options()).not.toContain('AI edit');
  expect(closed()).toBe(1);
  setDevice('desktop');
  vi.advanceTimersByTime(100);
  expect(options()).toContain('AI edit');
  expect(options()).not.toContain('Copy');
  expect(closed()).toBe(2);
  // One shell for the whole session: the popup registered with the host once.
  expect(registrations()).toBe(1);
});
