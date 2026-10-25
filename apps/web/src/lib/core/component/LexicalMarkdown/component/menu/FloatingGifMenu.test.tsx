/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { $createParagraphNode, $getRoot } from 'lexical';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { TRY_INSERT_GIF_COMMAND } from '../../plugins/gif';
import { FloatingGifMenu } from './FloatingGifMenu';

const insertGif = vi.hoisted(() => vi.fn());
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
  ],
}));
vi.mock('../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
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

afterEach(() => {
  cleanup();
  insertGif.mockClear();
  vi.useRealTimers();
});

function mountPicker() {
  const [canEdit, setCanEdit] = createSignal(true);
  let wrapper: ReturnType<typeof createLexicalWrapper>;
  render(() => {
    wrapper = createLexicalWrapper({
      type: 'markdown',
      namespace: 'gif-lock-test',
      isInteractable: canEdit,
    });
    onCleanup(wrapper.cleanup);
    return (
      <LexicalWrapperContext.Provider value={wrapper}>
        <FloatingGifMenu canEdit={canEdit} />
      </LexicalWrapperContext.Provider>
    );
  });
  const editor = wrapper!.editor;
  const open = () => {
    editor.update(
      () => {
        $getRoot().append($createParagraphNode());
        $getRoot().selectEnd();
        editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
      },
      { discrete: true }
    );
  };
  return { editor, open, setCanEdit };
}

it('inserts a selected GIF while editing remains allowed', async () => {
  const { open } = mountPicker();
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Audit GIF' }));
  expect(insertGif).toHaveBeenCalledOnce();
  expect(screen.queryByRole('searchbox')).toBeNull();
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

it('does not open a deferred picker after send locking', () => {
  vi.useFakeTimers();
  const { open, setCanEdit } = mountPicker();
  open();
  setCanEdit(false);
  vi.runOnlyPendingTimers();
  expect(screen.queryByRole('searchbox')).toBeNull();
});
