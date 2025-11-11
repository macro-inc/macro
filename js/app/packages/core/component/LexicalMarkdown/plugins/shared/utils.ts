import { mergeRegister } from '@lexical/utils';
import {
  type CommandListenerPriority,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  type LexicalEditor,
  type UpdateListener,
} from 'lexical';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';

export function mapRegisterDelete(
  editor: LexicalEditor,
  deleteFn: (payload: boolean) => boolean,
  priority: CommandListenerPriority
) {
  const deleteCommands = [
    DELETE_CHARACTER_COMMAND,
    DELETE_WORD_COMMAND,
    DELETE_LINE_COMMAND,
  ];
  return mergeRegister(
    ...deleteCommands.map((command) => {
      return editor.registerCommand(command, deleteFn, priority);
    })
  );
}

type WidthChangeCallback = (width: number) => void;

const observersByEditor = new WeakMap<
  LexicalEditor,
  {
    observer: ResizeObserver;
    callbacks: Set<WidthChangeCallback>;
  }
>();

/**
 * Register a callback that runs when the width of the editor root changes. If a
 * a selector is provided, then the closest matching parent will be observed
 * instead. If the selector fails then the editor root will still be observed.
 * @param editor
 * @param onWidthChange
 * @param selector
 * @returns
 */
export function registerEditorWidthObserver(
  editor: LexicalEditor,
  onWidthChange: WidthChangeCallback,
  selector?: string
) {
  function getObserver() {
    if (!observersByEditor.has(editor)) {
      const callbacks = new Set<WidthChangeCallback>([onWidthChange]);

      const observer = new ResizeObserver((entries) => {
        const w = entries[0].contentBoxSize[0].inlineSize;
        callbacks.forEach((callback) => callback(w));
      });

      observersByEditor.set(editor, { observer, callbacks });
      return { observer, callbacks };
    }

    const editorObserver = observersByEditor.get(editor)!;
    editorObserver.callbacks.add(onWidthChange);
    return editorObserver;
  }

  const { observer } = getObserver();

  return mergeRegister(
    editor.registerRootListener((root) => {
      observer.disconnect();
      if (root) {
        let element = root;
        if (selector) {
          element = root.closest(selector) ?? root;
        }
        const currentWidth = element.getBoundingClientRect().width;
        onWidthChange(currentWidth);
        observer.observe(element);
      }
    }),
    () => {
      const editorEntry = observersByEditor.get(editor);
      if (editorEntry) {
        editorEntry.observer.disconnect();
        observersByEditor.delete(editor);
      }
    }
  );
}

/**
 * Take a signal that might be undefined or a lexical editor and register some
 * plugin-style cleanup closure on it. As long as this is called in the
 * component tree, then the cleanups will be managed.
 * @param editor A signal that might be undefined or a lexical editor.
 * @param registerFunc Some function that registers one or more lexical listeners and
 *     returns a cleanup function.
 */
export function lazyRegister(
  editor: Accessor<LexicalEditor | undefined>,
  registerFunc: (editor: LexicalEditor) => () => void
) {
  let cleanup: () => void = () => {};
  createEffect(
    on(editor, (editor) => {
      cleanup();
      if (editor) {
        cleanup = registerFunc(editor);
      } else {
        cleanup = () => {};
      }
    })
  );
  onCleanup(cleanup);
  return () => cleanup();
}

/**
 * Register one or more Lexical listeners and automatically clean them up with
 * the calling component's life cycle.
 * @param fns The cleanup functions to register.
 */
export function autoRegister(...fns: Array<() => void>) {
  let cleanup = () => {
    for (const fn of fns) fn();
  };
  onCleanup(cleanup);
}

/**
 * Register a callback to run whenever a non-mutating layout shift occurs – like when
 * a decorator changes size without writing to the lexical state.
 * @param editor
 * @param listener
 * @returns
 */
export function registerInternalLayoutShiftListener(
  editor: LexicalEditor,
  listener: () => void
) {
  return editor.registerRootListener((root, prevRoot) => {
    if (prevRoot) {
      prevRoot.removeEventListener('internal-layout-shift', listener);
    }
    if (root) {
      root.addEventListener('internal-layout-shift', listener);
    }
  });
}

/**
 * Manually dispatch the internal layout shift event and trigger any listeners.
 * @param editor
 */
export function dispatchInternalLayoutShift(editor: LexicalEditor) {
  editor
    .getRootElement()
    ?.dispatchEvent(new CustomEvent('internal-layout-shift'));
}

/**
 * Wrapper on editor.registerUpdateListener that only calls the listener if there are dirty nodes.
 *     i.e. ignores selection change only updates.
 */
export function registerMutationListener(
  editor: LexicalEditor,
  fn: UpdateListener
) {
  return editor.registerUpdateListener((payload) => {
    if (payload.mutatedNodes !== null && payload.mutatedNodes.size > 0) {
      fn(payload);
    }
  });
}

/**
 * Wrapper on registerRootListener for nicer ergo on adding a single event
 * listener to the root div of a lexical editor.
 */
export function registerRootEventListener<K extends keyof HTMLElementEventMap>(
  editor: LexicalEditor,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  return editor.registerRootListener((root, prevRoot) => {
    if (prevRoot) {
      prevRoot.removeEventListener(type, listener, options);
    }
    if (root) {
      root.addEventListener(type, listener, options);
    }
  });
}
