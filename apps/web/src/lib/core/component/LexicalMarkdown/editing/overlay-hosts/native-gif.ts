import { staticFileIdEndpoint } from '@core/constant/servers';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import {
  createInputCommitObservation,
  type EditorView,
} from '@macro-inc/lexical-wasm-view';
import type { InputCommitEvidence } from '@macro-inc/lexical-wasm-view/view/input-commit-observation';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, onCleanup } from 'solid-js';
import { dispatchApplicationCommandSettledIfSessionEdit } from '../../plugins/group-b/command';
import type { GifMenuHost } from './gif';

/** The caret captured when the picker opened, with its typing attributes. */
interface NativeGifTarget {
  readonly view: EditorView;
  readonly generation: number;
  readonly selection: ViewSelection;
  readonly format: number;
  readonly style: string;
}

interface NativeGifInsertion {
  readonly view: EditorView;
  readonly generation: number;
  readonly root: HTMLElement;
  readonly canEdit: Accessor<boolean>;
  /** Source restores a saved selection; without one the live selection stays. */
  readonly target: NativeGifTarget | undefined;
}

interface PickerRegistration {
  readonly canEdit: Accessor<boolean>;
  readonly onOpen: () => void;
}

/** A captured range whose points the mirror no longer has (Source's recheck). */
function isRangeDetached(view: EditorView, selection: ViewSelection) {
  return (
    selection.kind === 'range' &&
    (!view.node(selection.anchor.key) || !view.node(selection.focus.key))
  );
}

/**
 * A captured node or table selection whose nodes are gone. Source does not
 * recheck these: $insertNodesAndSplitList attaches nothing, and the commit
 * still reports insertion (a shared orphan-upload leak, kept for parity).
 */
function isOtherDetached(view: EditorView, selection: ViewSelection) {
  if (selection.kind === 'node')
    return selection.keys.some((key) => !view.node(key));
  if (selection.kind === 'table')
    return (
      !view.node(selection.table) ||
      !view.node(selection.anchorCell) ||
      !view.node(selection.focusCell)
    );
  return false;
}

/** Images in the current mirror that reference this static file. */
function references(view: EditorView, staticFileId: string) {
  let count = 0;
  for (const node of view.mirror.values())
    if (node.type === 'image' && node.props().id === staticFileId) count++;
  return count;
}

/** A failing reporter must not turn an owned commit into a rejection. */
function reportInserted(onInserted: () => void) {
  try {
    onInserted();
  } catch (error) {
    try {
      Telemetry.error(error, { source: 'native-gif-on-inserted' });
    } catch {
      /* the upload stays owned either way */
    }
  }
}

/** Selections Source restores with `$setSelection(saved)`. */
function restorable(selection: ViewSelection) {
  return (
    selection.kind === 'range' ||
    selection.kind === 'node' ||
    selection.kind === 'table'
  );
}

/**
 * Native GIF picker host: one view, bound only after its initial projection.
 * Captures the caret on open, cancels on document changes, and inserts the
 * Source GIF image with `group-b.gif-insert` (Source list policy, and Source's
 * select-end only when no selection exists) at that caret, rechecking
 * freshness at the input's actual admission.
 */
export function createNativeGifContext(): {
  host: GifMenuHost<NativeGifTarget | null, NativeGifInsertion>;
  requestOpen(): boolean;
  bindView(view: EditorView): void;
  dispose(): void;
} {
  let view: EditorView | undefined;
  let generation: number | null = null;
  let picker: PickerRegistration | undefined;
  let alive = true;
  const currentView = () =>
    alive &&
    view?.isMounted &&
    generation !== null &&
    view.mirror.keyGeneration === generation
      ? view
      : undefined;
  /** Source `editor.isEditable()` plus the session's actual Edit access. */
  const editable = (mounted: EditorView) =>
    mounted.root.contentEditable === 'true' &&
    mounted.port instanceof SessionPort &&
    mounted.port.effectiveAccess() === Access.Edit;
  const fresh = (insertion: NativeGifInsertion) => {
    const mounted = currentView();
    return (
      mounted === insertion.view &&
      generation === insertion.generation &&
      mounted.root === insertion.root &&
      insertion.canEdit() &&
      editable(mounted) &&
      !(
        insertion.target && isRangeDetached(mounted, insertion.target.selection)
      )
    );
  };

  const host: GifMenuHost<NativeGifTarget | null, NativeGifInsertion> = {
    root: () => currentView()?.root ?? null,
    focus() {
      currentView()?.focus();
    },
    isEditable() {
      const mounted = currentView();
      return mounted !== undefined && editable(mounted);
    },
    captureTarget() {
      const mounted = currentView();
      if (!mounted || generation === null) return null;
      const { selection, format, style } = mounted.selection();
      return Object.freeze({
        view: mounted,
        generation,
        selection,
        format,
        style,
      });
    },
    prepareInsertion(target, canEdit) {
      const mounted = currentView();
      if (!canEdit() || !mounted || !editable(mounted) || generation === null)
        return;
      // A caret captured by a retired view or generation never retargets.
      if (
        target &&
        (target.view !== mounted || target.generation !== generation)
      )
        return;
      return Object.freeze({
        view: mounted,
        generation,
        root: mounted.root,
        canEdit,
        target: target && restorable(target.selection) ? target : undefined,
      });
    },
    subscribeChanges(insertion, onDirty) {
      return insertion.view.onCommit((commit) => {
        if (
          commit.mutations.size ||
          commit.children.size ||
          commit.properties.size
        )
          onDirty();
      });
    },
    isCurrent: fresh,
    async commit(insertion, gif, staticFileId, onInserted) {
      // A cleared draft or retired view must not receive the old request's image.
      if (!fresh(insertion)) return false;
      const mounted = insertion.view;
      const target = insertion.target;
      let reportedWithoutInsert = false;
      const insertNothing = () => {
        reportedWithoutInsert = true;
        reportInserted(onInserted);
        return true;
      };
      if (target && isOtherDetached(mounted, target.selection))
        return insertNothing();
      let before = 0;
      let evidence: InputCommitEvidence | undefined;
      const mainCommit = createInputCommitObservation((copied) => {
        evidence = copied;
      });
      let failure: { error: unknown } | undefined;
      try {
        await dispatchApplicationCommandSettledIfSessionEdit(
          mounted,
          'group-b.gif-insert',
          () => ({
            static_file_id: staticFileId,
            url: staticFileIdEndpoint(staticFileId),
            title: gif.title,
            width: gif.width,
            height: gif.height,
            ...(target?.selection.kind === 'range'
              ? { range_style: { format: target.format, style: target.style } }
              : {}),
          }),
          {
            ...(target ? { at: () => target.selection } : {}),
            admit: () => {
              if (!fresh(insertion)) return false;
              if (target && isOtherDetached(mounted, target.selection)) {
                insertNothing();
                return false;
              }
              before = references(mounted, staticFileId);
              return true;
            },
            mainCommit,
          }
        );
      } catch (error) {
        failure = { error };
      }
      if (reportedWithoutInsert) return true;
      // Ownership: this input's entry was published and the document gained a
      // reference to the file, read after every commit observer ran or threw.
      const published = evidence?.status === 'published';
      const referenced =
        published &&
        mounted.isMounted &&
        references(mounted, staticFileId) > before;
      // Source reports insertion whenever its command ran, even a NodeSelection
      // that attaches nothing; keeping that upload is the safe direction.
      const sourceInserted =
        evidence?.status === 'published' && evidence.mainHandled;
      if (referenced || sourceInserted) {
        // The upload stays owned, but a dispatch failure after publish (a later
        // commit observer) is still reported, as Source surfaces its listener errors.
        if (failure) {
          try {
            Telemetry.error(failure.error, {
              source: 'native-gif-insert-after-publish',
            });
          } catch {
            /* the upload stays owned either way */
          }
        }
        reportInserted(onInserted);
        return true;
      }
      if (failure) throw failure.error;
      return false;
    },
    registerPicker(canEdit, onOpen) {
      const entry = { canEdit, onOpen };
      picker = entry;
      onCleanup(() => {
        if (picker === entry) picker = undefined;
      });
    },
    registerPanel(panel, cancelUpload) {
      const root = currentView()?.root;
      onCleanup(cancelUpload);
      if (!root) return;
      const keepPanelFocus = (event: FocusEvent) => {
        if (
          event.relatedTarget instanceof Node &&
          panel.contains(event.relatedTarget)
        )
          event.stopPropagation();
      };
      root.addEventListener('focusout', keepPanelFocus);
      onCleanup(() => root.removeEventListener('focusout', keepPanelFocus));
    },
  };

  return {
    host,
    /** The slash-menu GIF request: opens the registered picker when editable. */
    requestOpen() {
      const entry = picker;
      if (!entry || !currentView() || !entry.canEdit()) return false;
      entry.onOpen();
      return true;
    },
    bindView(incoming) {
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      alive = false;
      picker = undefined;
      view = undefined;
      generation = null;
    },
  };
}
