import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { sameSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import type { Accessor } from 'solid-js';
import type {
  LinkMenuCallbacks,
  LinkMenuHost,
} from '../../../../lib/core/component/LexicalMarkdown/editing/overlay-hosts/link';
import { registerNativeLinks } from '../../../../lib/core/component/LexicalMarkdown/plugins/links/native';
import { isTouchDevice } from '../../../../lib/core/mobile/isTouchDevice';
import { fireAndForget } from '../../../../lib/core/util/fireAndForget';
import { openExternalUrl } from '../../../../lib/core/util/url';
import { createNativeFormattingActions } from './native-actions';
import { readNativeSelectionText } from './native-selection';

const enter = createViewCommand(
  'Key(Enter)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);
const escapeCommand = createViewCommand(
  'Key(Escape)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);

export interface NativeDocumentLinkMenuHost extends LinkMenuHost {
  requestLink(): void;
  dispose(): void;
  /** Pure terminal cleanup; native key handles remain with the view owner. */
  retire(): void;
}

/** One real document's menu, model target and native command registrations. */
export function createNativeDocumentLinkMenuHost(
  view: EditorView,
  options: { canEdit: Accessor<boolean>; alive: Accessor<boolean> }
): NativeDocumentLinkMenuHost {
  if (!view.port.nativeEnter || !view.port.nativeEscape)
    throw new Error('Native link menus require ordered Enter and Escape ports');
  const actions = createNativeFormattingActions(
    view,
    options.canEdit,
    options.alive
  );
  let callbacks: LinkMenuCallbacks | undefined;
  let disposed = false;
  let terminal = false;
  let opening = false;
  let openingEpoch = 0;
  const cleanups = new Set<() => void>();
  const active = () => !disposed && options.alive() && view.isMounted;
  const own = (cleanup: () => void, native = false) => {
    const run = () => {
      if (!native || !terminal) cleanup();
    };
    if (!active()) {
      run();
      return () => {};
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      cleanups.delete(release);
      run();
    };
    cleanups.add(release);
    return release;
  };
  const complete = async (pending: Promise<InputSettlement>) => {
    const result = await pending;
    if (result.status === 'error') throw result.error;
  };
  // Source dispatches INSERT/UPDATE_LINK*/UNLINK against the selection current at
  // dispatch (lexical-link.ts insert/update/updateUrl/unlink); so do these.
  const dispatch = (run: () => Promise<InputSettlement>) =>
    fireAndForget(
      complete(
        active()
          ? run()
          : Promise.reject(new Error('Native link menu is closed'))
      ),
      'markdown-link-menu'
    );

  async function open(): Promise<void> {
    if (!active() || !options.canEdit() || !callbacks || opening) return;
    const selection = view.selection().selection;
    if (
      selection.kind !== 'range' ||
      !view.getElementByKey(selection.focus.key)
    )
      return;
    const generation = view.mirror.keyGeneration;
    if (generation === null)
      throw new Error('Native link generation is unavailable');
    if (
      selection.anchor.key === selection.focus.key &&
      selection.anchor.offset === selection.focus.offset &&
      selection.anchor.type === selection.focus.type
    ) {
      callbacks.create({
        editAccess: true,
        selection: view.root.ownerDocument.getSelection(),
        autoFocus: true,
      });
      return;
    }
    const text = readNativeSelectionText(view);
    const epoch = ++openingEpoch;
    opening = true;
    let prepared:
      | {
          selection: typeof selection;
          generation: number;
        }
      | undefined;
    try {
      const result = await actions.prepareLink((handled) => {
        if (!handled) return;
        const selection = view.selection().selection;
        const generation = view.mirror.keyGeneration;
        if (selection.kind !== 'range' || generation === null)
          throw new Error('Native prepared link has no acknowledged range');
        prepared = { selection, generation };
      });
      if (result.status === 'error') throw result.error;
      if (result.status !== 'success' || !result.handled || !prepared) return;
      const accepted = prepared;
      // Source opens the edit controller asynchronously after its empty-link toggle.
      setTimeout(() => {
        if (
          !active() ||
          !options.canEdit() ||
          epoch !== openingEpoch ||
          view.mirror.keyGeneration !== accepted.generation ||
          !sameSelection(accepted.selection, view.selection().selection)
        )
          return;
        const linkRef = view.getElementByKey(accepted.selection.focus.key);
        if (!linkRef) return;
        callbacks?.click({
          editAccess: true,
          linkRef,
          url: '',
          linkText: text,
          autoFocus: true,
        });
      });
    } finally {
      opening = false;
    }
  }

  return {
    isEditable: () =>
      active() && options.canEdit() && view.root.contentEditable === 'true',
    isInteractable: () => active() && options.canEdit(),
    root: () => (active() ? view.root : null),
    focus: () => {
      if (active()) view.focus();
    },
    requestLink: () => fireAndForget(open(), 'markdown-link-menu'),
    registerMenu(next) {
      if (!active() || callbacks)
        throw new Error('Native link menu registration is unavailable');
      callbacks = next;
      own(
        registerNativeLinks(view, {
          open: openExternalUrl,
          isTouchDevice,
          onHoverLink: (info) => {
            if (active() && options.canEdit()) callbacks?.hover(info);
          },
          onClickLink: (info) => {
            if (!active() || !options.canEdit()) return;
            callbacks?.click(info);
          },
        })
      );
    },
    registerKeys(keys) {
      const releases = createNativeListenerScope();
      try {
        releases.add(
          own(
            view.registerViewCommand(
              escapeCommand,
              () => active() && keys.escape(),
              3
            ),
            true
          )
        );
        releases.add(
          own(
            view.registerViewCommand(enter, () => active() && keys.enter(), 4),
            true
          )
        );
      } catch (error) {
        return releases.fail(error);
      }
      return () => releases.dispose();
    },
    insert: (url, label) => dispatch(() => actions.insertLink(url, label)),
    update: (url, label) => dispatch(() => actions.updateLink(url, label)),
    updateUrl: (url) => dispatch(() => actions.updateLinkUrl(url)),
    unlink: () => dispatch(() => actions.unlink()),
    retire() {
      terminal = true;
      this.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      openingEpoch++;
      const current = callbacks;
      callbacks = undefined;
      const scope = createNativeListenerScope();
      for (const cleanup of cleanups) scope.add(cleanup);
      scope.add(() => current?.create());
      scope.dispose();
    },
  };
}
