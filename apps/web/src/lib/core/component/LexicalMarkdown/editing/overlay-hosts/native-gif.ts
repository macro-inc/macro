import { staticFileIdEndpoint } from '@core/constant/servers';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import { type Accessor, onCleanup } from 'solid-js';
import { dispatchApplicationCommandSettledIfSessionEdit } from '../../plugins/group-b/command';
import type { GifMenuHost } from './gif';

/** Source `$insertGifNode` caps the displayed width at 400px. */
const MAX_GIF_WIDTH = 400;

interface NativeGifTarget {
  readonly view: EditorView;
  readonly generation: number;
  readonly selection: ViewSelection;
}

interface NativeGifInsertion {
  readonly view: EditorView;
  readonly generation: number;
  readonly root: HTMLElement;
  readonly selection: ViewSelection | undefined;
}

interface PickerRegistration {
  readonly canEdit: Accessor<boolean>;
  readonly onOpen: () => void;
}

/** A captured range or node selection whose nodes the mirror no longer has. */
function isDetached(view: EditorView, selection: ViewSelection) {
  if (selection.kind === 'range')
    return !view.node(selection.anchor.key) || !view.node(selection.focus.key);
  if (selection.kind === 'node')
    return selection.keys.some((key) => !view.node(key));
  return false;
}

/**
 * Native GIF picker host: one view, bound only after its initial projection.
 * Captures the caret on open, cancels on document changes, and inserts the
 * Source GIF image through ordinary SessionEdit admission at that caret.
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
  const editable = (mounted: EditorView) =>
    mounted.root.contentEditable === 'true';

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
      return {
        view: mounted,
        generation,
        selection: mounted.selection().selection,
      };
    },
    prepareInsertion(target, canEdit) {
      const mounted = currentView();
      if (!canEdit() || !mounted || !editable(mounted) || generation === null)
        return;
      // Source restores a cloned selection, or selects the end when none.
      const selection =
        target && target.view === mounted && target.generation === generation
          ? target.selection
          : undefined;
      return { view: mounted, generation, root: mounted.root, selection };
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
    isCurrent(insertion) {
      const mounted = currentView();
      return (
        mounted === insertion.view &&
        generation === insertion.generation &&
        mounted.root === insertion.root &&
        editable(mounted)
      );
    },
    async commit(insertion, gif, staticFileId, onInserted) {
      const mounted = currentView();
      if (!mounted || !host.isCurrent(insertion)) return false;
      const at = insertion.selection;
      // A cleared draft must not receive the old request's image.
      if (at && isDetached(mounted, at)) return false;
      const width = Math.min(gif.width, MAX_GIF_WIDTH);
      let referenced = false;
      // Ownership follows the actual committed node, before later observers run.
      const stop = mounted.onCommit((commit) => {
        if (referenced) return;
        for (const mutation of commit.mutations.values()) {
          const node = mutation.after;
          if (
            mutation.kind === 'created' &&
            node?.type === 'image' &&
            node.props().id === staticFileId
          ) {
            referenced = true;
            onInserted();
            return;
          }
        }
      });
      try {
        await dispatchApplicationCommandSettledIfSessionEdit(
          mounted,
          'group-b.media',
          () => ({
            action: 'insert',
            kind: 'image',
            media: {
              srcType: 'sfs',
              id: staticFileId,
              url: staticFileIdEndpoint(staticFileId),
              width: gif.width,
              height: gif.height,
              constrainedWidth: width,
              constrainedHeight: Math.round((width / gif.width) * gif.height),
            },
            alt: gif.title,
          }),
          at && at.kind !== 'none' && at.kind !== 'keep' ? () => at : undefined
        );
      } catch (error) {
        // A referenced upload is kept even when admission reports a failure.
        if (!referenced) throw error;
      } finally {
        stop();
      }
      return referenced;
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
