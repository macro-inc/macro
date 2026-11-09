import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  PASTE_COMMAND,
  REDO_COMMAND,
  RootNode,
  type SerializedEditorState,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentMetadataPlugin } from '../plugins/document-metadata/documentMetadataPlugin';
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

// Observe the actual queue without replacing callbacks or flushing editor
// updates early. Each fence follows the callback's already scheduled Lexical
// commit; descendants keep the causal correction chain outstanding.
function queuedCorrections() {
  const schedule = globalThis.queueMicrotask;
  let complete: (() => void) | undefined;
  const drained = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let outstanding = 0;
  let scheduled = 0;
  const observer = vi
    .spyOn(globalThis, 'queueMicrotask')
    .mockImplementation((callback) => {
      outstanding += 1;
      scheduled += 1;
      schedule(() => {
        try {
          callback();
        } finally {
          schedule(() => {
            outstanding -= 1;
            if (outstanding === 0) {
              if (!complete) throw new Error('Missing microtask completion');
              complete();
            }
          });
        }
      });
    });
  return {
    drained,
    scheduled: () => scheduled,
    restore: () => observer.mockRestore(),
  };
}

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

describe('actual OFF paste correction history', () => {
  it('distinguishes the main paste from drained metadata corrections and restores one undo step through redo', async () => {
    const commits: { state: SerializedEditorState; tags: string[] }[] = [];
    const rootMutations: string[] = [];
    let canUndo = false;
    const { editor } = behaviorEditor((actual) => {
      const plugins = createPluginManager(actual, 'markdown')
        .history(400)
        .richText();
      actual.update(
        () => $getRoot().append($createParagraphNode()).selectEnd(),
        {
          discrete: true,
          tag: HISTORY_PUSH_TAG,
        }
      );
      plugins.use(documentMetadataPlugin({}));
      // Finish transform registration before the user paste. With no mutation
      // observer yet, metadata remains at its actual untouched default.
      actual.read(() => {});
      // Real mutation collection is a prerequisite of this production policy.
      plugins.use((current) =>
        current.registerMutationListener(
          RootNode,
          (mutations) => {
            rootMutations.push(...mutations.values());
          },
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
    const before = editor.getEditorState().toJSON();
    const beforeSelection = selection(editor);
    const event = new ClipboardEvent('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? 'correct me' : ''),
        types: ['text/plain'],
        files: [],
        items: [],
      },
    });
    const corrections = queuedCorrections();
    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    editor.read(() => {});
    const main = editor.getEditorState().toJSON();
    expect(event.defaultPrevented).toBe(true);
    expect(main).toEqual({
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
      },
    });
    expect(commits[0]?.state).toEqual(main);
    expect(commits[0]?.tags).toContain('paste');
    expect(commits[0]?.tags).not.toContain(HISTORY_MERGE_TAG);
    expect(main.root.$).toEqual(before.root.$);
    expect(corrections.scheduled()).toBeGreaterThan(0);
    await corrections.drained;
    corrections.restore();
    const drained = editor.getEditorState().toJSON();
    expect(drained).toEqual({
      ...main,
      root: {
        ...main.root,
        $: {
          ...main.root.$,
          documentMetadata: { version: MARKDOWN_VERSION_COUNTER },
        },
      },
    });
    expect(drained).not.toEqual(main);
    expect(commits).toHaveLength(4);
    expect(rootMutations).toHaveLength(3);
    expect(
      commits
        .slice(1)
        .every((commit) => commit.tags.includes(HISTORY_MERGE_TAG))
    ).toBe(true);
    expect(rootMutations).toContain('updated');
    expect(editor.read(() => $getRoot().getTextContent())).toBe('correct me');
    const atEnd = selection(editor);
    expect(atEnd.anchor).toEqual({ ...atEnd.focus, offset: 10, type: 'text' });
    expect(atEnd.focus.offset).toBe(10);
    expect(canUndo).toBe(true);

    const undoCorrections = queuedCorrections();
    expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(undoCorrections.scheduled()).toBeGreaterThan(0);
    await undoCorrections.drained;
    undoCorrections.restore();
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(selection(editor)).toEqual(beforeSelection);
    expect(canUndo).toBe(false);

    const redoCorrections = queuedCorrections();
    expect(editor.dispatchCommand(REDO_COMMAND, undefined)).toBe(true);
    editor.read(() => {});
    expect(redoCorrections.scheduled()).toBeGreaterThan(0);
    await redoCorrections.drained;
    redoCorrections.restore();
    expect(editor.getEditorState().toJSON()).toEqual(drained);
    expect(selection(editor)).toEqual(atEnd);
    expect(canUndo).toBe(true);
  });
});
