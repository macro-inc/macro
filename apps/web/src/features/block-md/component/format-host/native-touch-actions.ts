import type { ThreadId } from '@core/comments/commentType';
import {
  convertibleNativeLists,
  convertNativeListToTable,
} from '@core/component/LexicalMarkdown/plugins/tables/native';
import { toast } from '@core/component/Toast/Toast';
import { readNativePasteboardText } from '@core/mobile/nativeEditMenu';
import {
  Access,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import type { Accessor } from 'solid-js';
import type { NativeBodyTouchActions } from './native-body-popup';

/** The mirror's root key: top-level elements are its children. */
const ROOT_KEY = 0;

/** Source `$getConvertibleListFromSelection`: the published MODEL selection's
 *  anchor, its top-level element, when that is a list the native table plugin
 *  reports as convertible at the current generation. */
function selectedConvertibleList(view: EditorView): number | undefined {
  const selection = view.selection().selection;
  if (selection.kind !== 'range') return undefined;
  // Mirror ancestry only addresses the native convertibility query.
  let key = selection.anchor.key;
  for (;;) {
    const parent = view.mirror.node(key)?.parent;
    if (parent === undefined || parent === null) return undefined;
    if (parent === ROOT_KEY) break;
    key = parent;
  }
  return convertibleNativeLists(view).includes(key) ? key : undefined;
}

/** A clone of the MODEL selection the session last published. */
function publishedSelection(view: EditorView): ViewSelection {
  return structuredClone(view.selection().selection);
}

/** Source MarkdownPopup's touch handlers over the mounted native view. */
export function createNativeBodyTouchActions(options: {
  readonly documentId: Accessor<string>;
  /** The mounted native view, if any. */
  readonly view: Accessor<EditorView | undefined>;
  /** The document interaction accessor (Source canEdit for Table). */
  readonly canEdit: Accessor<boolean>;
  /** The overlay/document lifetime; nothing acts once it ended. */
  readonly alive: Accessor<boolean>;
  /** Source commentState.highlightedCommentThreads and its activation. */
  readonly comments: {
    readonly highlighted: Accessor<readonly ThreadId[]>;
    activate(thread: ThreadId): void;
  };
  /** The comment action, when the document mounts one. */
  readonly comment?: {
    readonly canComment: Accessor<boolean>;
    /** Source CREATE_DRAFT_COMMENT_COMMAND result. */
    insert(): boolean;
  };
  /** The live snippet link (Source handleShare), when one exists. */
  readonly snippetLink: NativeBodyTouchActions['share'];
}): NativeBodyTouchActions {
  /** The mounted view, while the overlay lives. */
  const live = () => {
    const view = options.view();
    return options.alive() && view?.isMounted ? view : undefined;
  };
  return {
    documentId: options.documentId,
    canComment: () => options.comment?.canComment() ?? false,
    insertComment(hide) {
      // Source MarkdownPopup.handleInsertComment.
      if (!options.comment?.insert()) {
        toast.failure('Please highlight text to comment.');
        return;
      }
      hide();
    },
    openComment: {
      available: () =>
        options.alive() && options.comments.highlighted().length > 0,
      open(hide) {
        // Source handleShowComment: clear the MODEL selection first (a
        // retained one would be re-applied and refocus the editor), then
        // blur so the keyboard closes, open the thread, hide the popup.
        const view = live();
        if (view) {
          view.port.selectionFromView({ kind: 'none' });
          view.root.blur();
        }
        const [thread] = options.comments.highlighted();
        if (thread !== undefined) options.comments.activate(thread);
        hide();
      },
    },
    share: options.snippetLink,
    table: {
      available: () => {
        const view = live();
        return (
          view !== undefined &&
          options.canEdit() &&
          selectedConvertibleList(view) !== undefined
        );
      },
      convert() {
        // Exactly the list holding the selection, at the current generation.
        const view = live();
        if (!view || !options.canEdit()) return false;
        const key = selectedConvertibleList(view);
        if (key === undefined) return false;
        return convertNativeListToTable(view, key) === true;
      },
    },
    async paste(hide) {
      // Source handlePaste: snapshot the MODEL selection before the async
      // pasteboard read (the tap and the read can move or collapse the DOM
      // selection), then insert the text raw at that selection, as Source's
      // insertRawText: no paste handling. After the await the overlay must
      // still live and the view be the same mounted editor at its generation;
      // the input itself is admitted only under Edit access.
      const view = live();
      const generation = view?.mirror.keyGeneration;
      if (!view || generation === null || generation === undefined) return;
      const selection = publishedSelection(view);
      if (selection.kind !== 'range') return;
      const text = await readNativePasteboardText();
      if (!text) return;
      const port = view.port;
      if (
        live() !== view ||
        view.mirror.keyGeneration !== generation ||
        !(port instanceof SessionPort) ||
        port.effectiveAccess() !== Access.Edit
      )
        return;
      port.inputIfSessionEdit(
        EditorInputMsg.fromEditorInsertText({
          phase: 0, // BeforeInput: no data plus a transfer is insert_raw_text.
          hasData: false,
          data: '',
          hasTransfer: true,
          transfer: text,
          facts: 0,
          lastKey: '',
          selection: selectionMessage(selection),
        })
      );
      hide();
    },
  };
}
