/** @vitest-environment jsdom */
import { computePosition } from '@floating-ui/dom';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from 'lexical';
import { err, ok, type Result } from 'neverthrow';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createMenuOpenSignal,
  FloatingMenuGroup,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { TRY_INSERT_GIF_COMMAND } from '../../plugins/gif';
import { FocusClickTarget } from '../core/FocusClickTarget';
import { FloatingGifMenu } from './FloatingGifMenu';

const insertGif = vi.hoisted(() => vi.fn());
const uploadGif = vi.hoisted(() => vi.fn());
const discardUpload = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../plugins/gif/uploadGif', () => ({ uploadGif }));
vi.mock('@core/util/uploadFile', async (original) => ({
  ...(await original<typeof import('@core/util/uploadFile')>()),
  discardStaticUpload: discardUpload,
}));
const touchDevice = vi.hoisted(() => vi.fn(() => false));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: touchDevice,
}));
vi.mock('../../plugins/gif', async (original) => ({
  ...(await original<typeof import('../../plugins/gif')>()),
  $insertGifNode: insertGif,
  searchGifs: async () => [
    {
      id: 'audit-gif',
      title: 'Audit GIF',
      previewUrl: 'https://example.com/preview.gif',
      url: 'https://example.com/audit.gif',
      width: 100,
      height: 100,
    },
    {
      id: 'second-gif',
      title: 'Second GIF',
      previewUrl: 'https://example.com/second-preview.gif',
      url: 'https://example.com/second.gif',
      width: 100,
      height: 100,
    },
    {
      id: 'third-gif',
      title: 'Third GIF',
      previewUrl: 'https://example.com/third-preview.gif',
      url: 'https://example.com/third.gif',
      width: 100,
      height: 100,
    },
    {
      id: 'fourth-gif',
      title: 'Fourth GIF',
      previewUrl: 'https://example.com/fourth-preview.gif',
      url: 'https://example.com/fourth.gif',
      width: 100,
      height: 100,
    },
  ],
}));
vi.mock('@floating-ui/dom', async (original) => ({
  ...(await original<typeof import('@floating-ui/dom')>()),
  computePosition: vi.fn(async () => ({
    x: 100,
    y: 200,
    placement: 'top-start',
    strategy: 'fixed',
    middlewareData: {},
  })),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob() {},
}));

beforeEach(() => {
  uploadGif.mockResolvedValue(ok('static-gif-id'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  insertGif.mockClear();
  uploadGif.mockReset();
  discardUpload.mockClear();
  vi.mocked(computePosition).mockClear();
  vi.unstubAllGlobals();
  touchDevice.mockReturnValue(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mountPicker(companionPriority?: number) {
  const [canEdit, setCanEdit] = createSignal(true);
  const leaveComposer = vi.fn();
  let wrapper: ReturnType<typeof createLexicalWrapper>;
  let companionOpen = () => false;
  function CompanionMenu() {
    [companionOpen] = createMenuOpenSignal(
      'companion-menu',
      companionPriority ?? MenuPriority.Normal,
      companionPriority !== undefined
    );
    return null;
  }
  const view = render(() => {
    wrapper = createLexicalWrapper({
      type: 'markdown',
      namespace: 'gif-lock-test',
      isInteractable: canEdit,
    });
    onCleanup(wrapper.cleanup);
    return (
      <LexicalWrapperContext.Provider value={wrapper}>
        <FloatingMenuGroup>
          <CompanionMenu />
          <FocusClickTarget
            editor={wrapper.editor}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next))
                return;
              leaveComposer();
            }}
          >
            <div
              ref={(element) =>
                onMount(() => wrapper.editor.setRootElement(element))
              }
              contentEditable
            />
            <FloatingGifMenu canEdit={canEdit} />
          </FocusClickTarget>
        </FloatingMenuGroup>
      </LexicalWrapperContext.Provider>
    );
  });
  const editor = wrapper!.editor;
  const open = () => {
    editor.getRootElement()?.focus();
    editor.update(
      () => {
        $getRoot().append($createParagraphNode());
        $getRoot().selectEnd();
        editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
      },
      { discrete: true }
    );
  };
  return {
    editor,
    open,
    setCanEdit,
    leaveComposer,
    companionOpen,
    unmount: view.unmount,
  };
}

it('positions the picker at the editor when there is no selection', async () => {
  const { editor } = mountPicker();
  window.getSelection()?.removeAllRanges();
  editor.update(
    () => {
      editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
    },
    { discrete: true }
  );
  const input = await screen.findByRole('searchbox');
  const panel = input.closest('[data-holds-prompts]')!;
  await waitFor(() => expect(panel).toHaveProperty('style.top', '200px'));
  expect(panel).toHaveProperty('style.visibility', 'visible');
  expect(vi.mocked(computePosition).mock.lastCall?.[0]).toBe(
    editor.getRootElement()
  );
});
it.each([MenuPriority.Normal, MenuPriority.High])(
  'opens the GIF picker over an existing menu with priority %s',
  async (priority) => {
    const { open, companionOpen } = mountPicker(priority);
    expect(companionOpen()).toBe(true);
    open();
    expect(await screen.findByRole('searchbox')).toBe(document.activeElement);
    expect(companionOpen()).toBe(false);
  }
);

it.each(['element', 'text'])(
  'keeps the editor %s anchor when search takes focus',
  async (anchorType) => {
    const { editor } = mountPicker();
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode('hello')
        );
        $getRoot().append(paragraph);
        paragraph.selectEnd();
      },
      { discrete: true }
    );
    const root = editor.getRootElement()!;
    root.focus();
    const anchor =
      anchorType === 'text'
        ? document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode()!
        : root;
    const range = document.createRange();
    range.selectNodeContents(anchor);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement
    ) {
      nativeFocus.call(this);
      if (this instanceof HTMLInputElement) selection.removeAllRanges();
    });
    editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);
    const panel = input.closest('[data-holds-prompts]')!;
    await waitFor(() => expect(panel).toHaveProperty('style.top', '200px'));
    expect(panel).toHaveProperty('style.visibility', 'visible');
    const reference = vi.mocked(computePosition).mock.lastCall?.[0];
    if (anchorType === 'text') {
      expect(reference).toBeInstanceOf(Range);
      expect(reference).toMatchObject({
        startContainer: anchor,
        endContainer: anchor,
        startOffset: 5,
        endOffset: 5,
        collapsed: true,
      });
    } else {
      expect(reference).toBe(root);
    }
  }
);

it.each([false, true])(
  'focuses search during opening and keeps composer clicks out on touch=%s',
  async (touch) => {
    touchDevice.mockReturnValue(touch);
    const { open, leaveComposer } = mountPicker();
    open();
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);
    expect(leaveComposer).not.toHaveBeenCalled();

    expect(fireEvent.pointerDown(input)).toBe(true);
    expect(fireEvent.mouseDown(input)).toBe(true);
    expect(fireEvent.click(input)).toBe(true);
    expect(document.activeElement).toBe(input);

    input.blur();
    fireEvent.click(screen.getByRole('group'));
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: 'hello' } });
    expect(input).toHaveProperty('value', 'hello');

    fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
    await waitFor(() => expect(insertGif).toHaveBeenCalledOnce());
    expect(screen.queryByRole('searchbox')).toBeNull();
  }
);

it('preserves native blur and outside focus while search owns composer focus', () => {
  const { editor, open, leaveComposer } = mountPicker();
  const nativeBlur = vi.fn();
  editor.getRootElement()!.addEventListener('blur', nativeBlur);
  render(() => <input aria-label="Outside composer" />);
  open();
  expect(nativeBlur).toHaveBeenCalledOnce();
  expect(leaveComposer).not.toHaveBeenCalled();

  screen.getByRole('textbox', { name: 'Outside composer' }).focus();
  expect(leaveComposer).toHaveBeenCalledOnce();

  editor.getRootElement()!.focus();
  screen.getByRole('textbox', { name: 'Outside composer' }).focus();
  expect(leaveComposer).toHaveBeenCalledTimes(2);
});

it('removes the composer focus guard when the picker closes', () => {
  const { editor, open, leaveComposer } = mountPicker();
  open();
  const input = screen.getByRole('searchbox');
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.focusOut(editor.getRootElement()!, { relatedTarget: input });
  expect(leaveComposer).toHaveBeenCalledOnce();
});

it('inserts a GIF when the editor has no saved caret', async () => {
  const { editor } = mountPicker();
  editor.update(
    () => {
      $getRoot().append($createParagraphNode());
      editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
    },
    { discrete: true }
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  await waitFor(() => expect(insertGif).toHaveBeenCalledOnce());
});

it('inserts a selected GIF while editing remains allowed', async () => {
  const { open } = mountPicker();
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  await waitFor(() => expect(insertGif).toHaveBeenCalledOnce());
  expect(screen.queryByRole('searchbox')).toBeNull();
});
it('restores the insertion caret after searching outside the editor', async () => {
  const { editor } = mountPicker();
  editor.update(
    () => {
      const text = $createTextNode('hello');
      $getRoot().append($createParagraphNode().append(text));
      text.select(2, 2);
      editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
    },
    { discrete: true }
  );
  const input = screen.getByRole('searchbox');
  fireEvent.click(input);
  fireEvent.input(input, { target: { value: 'hello' } });
  let offset: number | undefined;
  insertGif.mockImplementationOnce(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) offset = selection.anchor.offset;
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  editor.update(() => $setSelection(null), { discrete: true });
  await waitFor(() => expect(insertGif).toHaveBeenCalledOnce());
  expect(offset).toBe(2);
});

it('steps through grid rows, scrolls only on keyboard movement, and inserts the selected GIF', async () => {
  const { open } = mountPicker();
  open();
  const input = await screen.findByRole('searchbox');
  const first = await screen.findByRole('button', { name: 'Audit GIF' });
  const second = screen.getByRole('button', { name: 'Second GIF' });
  const third = screen.getByRole('button', { name: 'Third GIF' });
  const fourth = screen.getByRole('button', { name: 'Fourth GIF' });
  first.scrollIntoView = vi.fn();
  second.scrollIntoView = vi.fn();
  third.scrollIntoView = vi.fn();
  fourth.scrollIntoView = vi.fn();

  fireEvent.pointerEnter(second);
  expect(second.scrollIntoView).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(fourth.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(second.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  expect(first.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(third.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  // Scrolling can move another result under the pointer during a key press.
  fireEvent.pointerEnter(first);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(insertGif).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'third-gif' }),
      'static-gif-id'
    )
  );
});

it('rejects a GIF selection after the editor becomes readonly', async () => {
  const { editor, open } = mountPicker();
  open();
  const gif = await screen.findByRole('button', { name: 'Audit GIF' });
  editor.setEditable(false);
  fireEvent.click(gif);
  expect(insertGif).not.toHaveBeenCalled();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('closes an open picker when send locking removes edit permission', async () => {
  const { open, setCanEdit } = mountPicker();
  open();
  await screen.findByRole('button', { name: 'Audit GIF' });
  setCanEdit(false);
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(insertGif).not.toHaveBeenCalled();
});

it('closes the picker when send locking removes edit permission immediately after opening', () => {
  vi.useFakeTimers();
  const { open, setCanEdit } = mountPicker();
  open();
  setCanEdit(false);
  vi.runOnlyPendingTimers();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('uploads once before inserting, even when Enter repeats during the upload', async () => {
  let resolveUpload!: (id: string) => void;
  const pending = new Promise<Result<string, never>>((resolve) => {
    resolveUpload = (id) => resolve(ok(id));
  });
  uploadGif.mockReturnValueOnce(pending);
  const { open } = mountPicker();
  open();
  const button = await screen.findByRole('button', { name: 'Audit GIF' });
  fireEvent.click(button);
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
  expect(uploadGif).toHaveBeenCalledOnce();
  expect(button).toHaveProperty('disabled', true);
  expect(insertGif).not.toHaveBeenCalled();
  resolveUpload('uploaded-gif');
  await waitFor(() =>
    expect(insertGif).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'audit-gif' }),
      'uploaded-gif'
    )
  );
  expect(discardUpload).not.toHaveBeenCalled();
});

it('keeps the picker and caret for retry after upload failure', async () => {
  uploadGif.mockResolvedValueOnce(err({ kind: 'failed' }));
  const { open } = mountPicker();
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  await screen.findByRole('alert');
  expect(insertGif).not.toHaveBeenCalled();
  expect(screen.getByRole('searchbox')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Audit GIF' });
  expect(button).toHaveProperty('disabled', false);
  fireEvent.click(button);
  await waitFor(() => expect(insertGif).toHaveBeenCalledOnce());
  expect(uploadGif).toHaveBeenCalledTimes(2);
});

it.each([
  'dismissed',
  'readonly',
  'permission lost',
  'disposed',
  'draft changed',
])(
  'does not insert a completed upload after the picker is %s',
  async (reason) => {
    let resolveUpload!: (id: string) => void;
    const pending = new Promise<Result<string, never>>((resolve) => {
      resolveUpload = (id) => resolve(ok(id));
    });
    uploadGif.mockReturnValueOnce(pending);
    const { editor, open, setCanEdit, unmount } = mountPicker();
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
    if (reason === 'dismissed') {
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    } else if (reason === 'readonly') {
      editor.setEditable(false);
    } else if (reason === 'permission lost') {
      setCanEdit(false);
    } else if (reason === 'disposed') {
      unmount();
    } else {
      editor.update(() => $getRoot().clear(), { discrete: true });
    }
    resolveUpload('uploaded-gif');
    await pending;
    expect(insertGif).not.toHaveBeenCalled();
    expect(discardUpload).toHaveBeenCalledWith('uploaded-gif');
  }
);

it('ignores a dismissed upload after the picker reopens', async () => {
  let resolveUpload!: (id: string) => void;
  const pending = new Promise<Result<string, never>>((resolve) => {
    resolveUpload = (id) => resolve(ok(id));
  });
  uploadGif.mockReturnValueOnce(pending);
  const { open } = mountPicker();
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Second GIF' }));
  await waitFor(() =>
    expect(insertGif).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'second-gif' }),
      'static-gif-id'
    )
  );
  resolveUpload('old-upload');
  await pending;
  expect(insertGif).toHaveBeenCalledOnce();
  expect(discardUpload).toHaveBeenCalledWith('old-upload');
});
