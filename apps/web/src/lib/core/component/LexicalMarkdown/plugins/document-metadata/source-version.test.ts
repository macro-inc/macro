import 'fake-indexeddb/auto';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type SerializedEditorState,
  type SerializedParagraphNode,
  type SerializedTextNode,
} from 'lexical';
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { initializeEditorWithVersionedState } from '../../utils';
import { MARKDOWN_VERSION_COUNTER } from '../../version';
import { documentMetadataPlugin } from './documentMetadataPlugin';

vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: {
    send() {},
    addEventListener() {},
    removeEventListener() {},
    reconnectIfDisconnected() {},
  },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
  parseWebsocketPayload: () => undefined,
}));

const text: SerializedTextNode = {
  type: 'text',
  version: 1,
  text: 'Before',
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
  $: { id: 'leaf0001' },
};
const paragraph: SerializedParagraphNode = {
  type: 'paragraph',
  version: 1,
  children: [text],
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
  $: { id: 'para0001' },
};
const state: SerializedEditorState = {
  root: {
    type: 'root',
    version: 1,
    children: [paragraph],
    direction: null,
    format: '',
    indent: 0,
    $: {
      id: 'root0001',
      documentMetadata: {
        version: MARKDOWN_VERSION_COUNTER + 1,
        environmentTags: null,
      },
    },
  },
};

// A discrete update drains Lexical's pending update; two microtask turns drain
// the plugin's queued version write and Lexical's scheduled commit.
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('records Source version-error triggers on load, text and root changes', async () => {
  let dispose!: () => void;
  const wrapper = createRoot((release) => {
    dispose = release;
    return createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'version-control',
      withIds: true,
      isInteractable: () => true,
    });
  });
  const editor = wrapper.editor;
  editor.setRootElement(document.createElement('div'));
  wrapper.plugins.richText();
  const error = vi.fn();
  const unregister = documentMetadataPlugin({ onVersionError: error })(editor);
  try {
    // Drain wrapper registration against a current, fully identified state.
    editor.setEditorState(
      editor.parseEditorState({
        ...state,
        root: {
          ...state.root,
          $: {
            id: 'root0001',
            documentMetadata: {
              version: MARKDOWN_VERSION_COUNTER,
              environmentTags: null,
            },
          },
        },
      })
    );
    await settle();
    error.mockClear();
    editor.setEditorState(editor.parseEditorState(state));
    await settle();
    const setState = error.mock.calls.length;
    error.mockClear();
    const loadError = initializeEditorWithVersionedState(editor, state);
    await settle();
    const appLoad = error.mock.calls.length;
    expect(editor.getRootElement()?.textContent).toBe('Before');
    // CollabProvider.tsx:565-581 returns on this error before startSync and
    // setEditorReady. This test measures the initializer, not provider lifecycle.
    error.mockClear();
    // Plugin-only control: the app itself returns on the preceding load error.
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (text?.getType() !== 'text') throw new Error('expected text');
        text.selectEnd().insertText('!');
      },
      { discrete: true }
    );
    await settle();
    const typeText = error.mock.calls.length;
    error.mockClear();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('After'))
        );
      },
      { discrete: true }
    );
    await settle();
    const insertRoot = error.mock.calls.length;
    console.log(
      'Source v12 version triggers',
      JSON.stringify({
        setState,
        appLoad,
        typeText,
        insertRoot,
        loadError,
      })
    );
    expect(loadError).toBe('VERSION_MISMATCH_ERROR');
    // The app consumer only sets one error signal; duplicate callbacks are facts,
    // not a user-visible contract.
    expect({
      setState: setState > 0,
      appLoad: appLoad > 0,
      typeText: typeText > 0,
      insertRoot: insertRoot > 0,
    }).toEqual({
      setState: false,
      appLoad: true,
      typeText: true,
      insertRoot: true,
    });
  } finally {
    unregister();
    wrapper.cleanup();
    editor.setRootElement(null);
    dispose();
  }
});
