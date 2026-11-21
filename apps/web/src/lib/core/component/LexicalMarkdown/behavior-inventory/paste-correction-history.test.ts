import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  HISTORIC_TAG,
  type LexicalEditor,
  PASTE_COMMAND,
  REDO_COMMAND,
  RootNode,
  type SerializedEditorState,
  type SerializedParagraphNode,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  documentMetadataPlugin,
  LOAD_STATE_TAG,
} from '../plugins/document-metadata/documentMetadataPlugin';
import { createPluginManager } from '../plugins/pluginManager';
import { MARKDOWN_VERSION_COUNTER } from '../version';
import { behaviorEditor } from './editor';

vi.mock('@core/internal/BlockLoader', () => ({}));
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

class FixtureClipboardEvent extends Event {}
class FixtureDragEvent extends Event {}
beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', FixtureClipboardEvent);
  vi.stubGlobal('DragEvent', FixtureDragEvent);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selection(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const value = $getSelection();
    if (!$isRangeSelection(value)) throw new Error('Expected an actual range');
    return {
      anchor: {
        key: value.anchor.key,
        offset: value.anchor.offset,
        type: value.anchor.type,
      },
      focus: {
        key: value.focus.key,
        offset: value.focus.offset,
        type: value.focus.type,
      },
    };
  });
}

function pasteEditor(stamped: boolean) {
  const commits: { state: SerializedEditorState; tags: string[] }[] = [];
  const rootMutations: string[] = [];
  let canUndo = false;
  const { editor } = behaviorEditor((actual) => {
    const plugins = createPluginManager(actual, 'markdown')
      .history(400)
      .richText();
    plugins.use(documentMetadataPlugin({}));
    const paragraph: SerializedParagraphNode = {
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
      textFormat: 0,
      textStyle: '',
    };
    actual.setEditorState(
      actual.parseEditorState({
        root: {
          children: [paragraph],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
          ...(stamped
            ? { $: { documentMetadata: { version: MARKDOWN_VERSION_COUNTER } } }
            : {}),
        },
      }),
      { tag: LOAD_STATE_TAG }
    );
    // Only the document-changing load gets LOAD_STATE_TAG. Tagging this
    // selection-only update would carry the tag into the user's next paste.
    actual.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), {
      discrete: true,
    });
    actual.read(() => {});
    plugins.use((current) =>
      current.registerMutationListener(
        RootNode,
        (mutations) => rootMutations.push(...mutations.values()),
        { skipInitialization: true }
      )
    );
    plugins.use((current) =>
      current.registerUpdateListener(({ editorState, tags }) => {
        commits.push({ state: editorState.toJSON(), tags: [...tags] });
      })
    );
    plugins.use((current) =>
      current.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          canUndo = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
    return () => plugins.cleanup();
  });
  return { editor, commits, rootMutations, canUndo: () => canUndo };
}

function paste(editor: LexicalEditor) {
  const event = new ClipboardEvent('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? 'correct me' : ''),
      types: ['text/plain'],
      files: [],
      items: [],
    },
  });
  expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
  editor.read(() => {});
  expect(event.defaultPrevented).toBe(true);
}

const pastedState = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'correct me',
            type: 'text',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
    $: { documentMetadata: { version: MARKDOWN_VERSION_COUNTER } },
  },
};

describe('actual OFF paste correction history', () => {
  it('keeps an already-stamped paste in one history step through undo and redo', () => {
    const { editor, commits, rootMutations, canUndo } = pasteEditor(true);
    // Source parses an existing metadata slot with absent environment tags
    // as null; a newly authored stamp below contains only its version.
    const pasted = {
      ...pastedState,
      root: {
        ...pastedState.root,
        $: {
          documentMetadata: {
            version: MARKDOWN_VERSION_COUNTER,
            environmentTags: null,
          },
        },
      },
    };
    const before = editor.getEditorState().toJSON();
    const beforeSelection = selection(editor);
    const scheduled = vi.spyOn(globalThis, 'queueMicrotask');
    paste(editor);
    expect(editor.getEditorState().toJSON()).toEqual(pasted);
    expect(commits).toEqual([{ state: pasted, tags: ['paste'] }]);
    expect(rootMutations).toEqual([]);
    expect(scheduled).not.toHaveBeenCalled();
    const atEnd = selection(editor);
    expect(atEnd.anchor).toEqual({ ...atEnd.focus, offset: 10, type: 'text' });
    expect(canUndo()).toBe(true);

    expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(selection(editor)).toEqual(beforeSelection);
    expect(canUndo()).toBe(false);
    expect(commits).toHaveLength(3);
    expect(rootMutations).toEqual(['updated']);

    expect(editor.dispatchCommand(REDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(pasted);
    expect(selection(editor)).toEqual(atEnd);
    expect(canUndo()).toBe(true);
    expect(commits).toHaveLength(5);
    expect(
      commits.slice(1).every((commit) => commit.tags.includes(HISTORIC_TAG))
    ).toBe(true);
    expect(rootMutations).toEqual(['updated', 'updated']);
  });

  it('stamps a legacy root in the paste commit and undoes to its exact stored absence', () => {
    const { editor, commits, rootMutations, canUndo } = pasteEditor(false);
    const before = editor.getEditorState().toJSON();
    const beforeSelection = selection(editor);
    expect(before.root).not.toHaveProperty('$');
    const scheduled = vi.spyOn(globalThis, 'queueMicrotask');
    paste(editor);
    expect(editor.getEditorState().toJSON()).toEqual(pastedState);
    expect(commits).toEqual([{ state: pastedState, tags: ['paste'] }]);
    expect(rootMutations).toEqual(['updated']);
    expect(scheduled).not.toHaveBeenCalled();
    expect(canUndo()).toBe(true);

    expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(selection(editor)).toEqual(beforeSelection);
    expect(canUndo()).toBe(false);
    expect(commits).toHaveLength(3);
    expect(rootMutations).toEqual(['updated', 'updated']);
  });

  // Known Source snapshot-history failure (mac-wasm-rust.22):
  // https://github.com/macro-inc/macro/pull/11792. Keep the real
  // redo assertion until the separate producer fix lands and is integrated.
  it.fails('restores the first legacy-root paste through redo (Source #11792)', () => {
    const { editor } = pasteEditor(false);
    const before = editor.getEditorState().toJSON();
    expect(before.root).not.toHaveProperty('$');
    paste(editor);
    const atEnd = selection(editor);
    expect(editor.getEditorState().toJSON()).toEqual(pastedState);
    expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(before);

    expect(editor.dispatchCommand(REDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(editor.getEditorState().toJSON()).toEqual(pastedState);
    expect(selection(editor)).toEqual(atEnd);
  });
});
