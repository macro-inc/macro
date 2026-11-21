import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerRichText } from '@lexical/rich-text';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
  NODE_STATE_KEY,
  PASTE_COMMAND,
  REDO_COMMAND,
  RootNode,
  type SerializedEditorState,
  type SerializedParagraphNode,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKDOWN_VERSION_COUNTER } from '../../version';
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
  LOAD_STATE_TAG,
} from './documentMetadataPlugin';

class FixtureClipboardEvent extends Event {}
class FixtureDragEvent extends Event {}

beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', FixtureClipboardEvent);
  vi.stubGlobal('DragEvent', FixtureDragEvent);
});

afterEach(() => vi.unstubAllGlobals());

function selection(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const value = $getSelection();
    if (!$isRangeSelection(value))
      throw new Error('Expected a range selection');
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

describe('document metadata history', () => {
  it.each([undefined, MARKDOWN_VERSION_COUNTER - 1, MARKDOWN_VERSION_COUNTER])(
    'restores paste, metadata and selection through undo/redo from version %s',
    (version) => {
      const editor = createEditor({
        onError(error) {
          throw error;
        },
      });
      const root = document.createElement('div');
      root.contentEditable = 'true';
      document.body.append(root);
      editor.setRootElement(root);
      const stopHistory = registerHistory(
        editor,
        createEmptyHistoryState(),
        400
      );
      const stopRichText = registerRichText(editor);
      const stopMetadata = documentMetadataPlugin({})(editor);
      // Mutation collection matches the production editor's root observers.
      const stopMutations = editor.registerMutationListener(
        RootNode,
        () => {},
        {
          skipInitialization: true,
        }
      );
      const commits: SerializedEditorState[] = [];
      let stopUpdates = () => {};
      try {
        const stored: SerializedEditorState<SerializedParagraphNode> = {
          root: {
            children: [
              {
                children: [],
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
            ...(version === undefined
              ? {}
              : { [NODE_STATE_KEY]: { documentMetadata: { version } } }),
          },
        };
        editor.setEditorState(editor.parseEditorState(stored), {
          tag: LOAD_STATE_TAG,
        });
        // A selection-only LOAD tag would leak into the following paste.
        editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), {
          discrete: true,
        });
        editor.read(() => {});
        const before = editor.getEditorState().toJSON();
        const beforeSelection = selection(editor);
        expect(editor.read(() => $getDocumentMetadata().version)).toBe(
          version ?? -1
        );
        stopUpdates = editor.registerUpdateListener(({ editorState }) => {
          commits.push(editorState.toJSON());
        });
        const event = new ClipboardEvent('paste', { cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: {
            getData: (type: string) =>
              type === 'text/plain' ? 'Pasted text' : '',
            types: ['text/plain'],
            files: [],
            items: [],
          },
        });

        expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
        editor.read(() => {});
        const pasted = editor.getEditorState().toJSON();
        const pastedSelection = selection(editor);
        expect(event.defaultPrevented).toBe(true);
        expect(editor.read(() => $getRoot().getTextContent())).toBe(
          'Pasted text'
        );
        expect(commits).toEqual([pasted]);
        expect(pasted.root[NODE_STATE_KEY]?.documentMetadata).toMatchObject({
          version: MARKDOWN_VERSION_COUNTER,
        });

        expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
        editor.read(() => {});
        expect(editor.getEditorState().toJSON()).toEqual(before);
        expect(selection(editor)).toEqual(beforeSelection);

        expect(editor.dispatchCommand(REDO_COMMAND, undefined)).toBe(true);
        editor.read(() => {});
        expect(editor.getEditorState().toJSON()).toEqual(pasted);
        expect(selection(editor)).toEqual(pastedSelection);

        // Rewinding history must not prevent the next actual edit's stamp.
        expect(editor.dispatchCommand(UNDO_COMMAND, undefined)).toBe(true);
        editor.read(() => {});
        expect(editor.getEditorState().toJSON()).toEqual(before);
        commits.length = 0;
        expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
        editor.read(() => {});
        expect(editor.getEditorState().toJSON()).toEqual(pasted);
        expect(commits).toEqual([pasted]);
      } finally {
        stopUpdates();
        stopMutations();
        stopMetadata();
        stopRichText();
        stopHistory();
        editor.setRootElement(null);
        root.remove();
      }
    }
  );
});
