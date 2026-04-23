/**
 * Undo/redo support for mutations.
 *
 * @example
 * // 1. Wrap your app with the provider
 * <MutationUndoProvider>
 *   <App />
 * </MutationUndoProvider>
 *
 * // 2. Push an entry directly and bind side effects (toast, highlight, etc.)
 * //    to its lifecycle hooks.
 * const { pushUndo } = useMutationUndoContext();
 * const handle = pushUndo({
 *   undo: async () => api.update(id, previousValue),
 *   redo: async () => api.update(id, nextValue),
 *   onUndone: () => toast.dismiss(toastId),
 *   onRedone: () => showToast(),
 * });
 *
 * // 3. Target this specific entry from UI (e.g. an Undo button):
 * handle.undo({ onError: (e) => toast.failure(e.message) });
 *
 * // 4. Global LIFO shortcuts (cmd+z / shift+cmd+z) use the stack top:
 * const { undo, redo, canUndo, canRedo } = useMutationUndoContext();
 */

import { type MutationOptions, useMutation } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { createAssertedContextProvider } from '@core/context/createContext';

type UndoHandler<TVariables, TContext> = (
  variables: TVariables,
  context: TContext | undefined
) => Promise<void> | void;

type UndoEntry = {
  id: string;
  undo: () => Promise<void> | void;
  redo?: () => Promise<void> | void;
  label?: string;
  /** Fires after `undo` resolves, regardless of whether it was triggered by
   *  `handle.undo()` or the global `ctx.undo()` LIFO call. */
  onUndone?: () => void;
  /** Fires after `redo` resolves. */
  onRedone?: () => void;
};

export type UndoEntryInput = Omit<UndoEntry, 'id'>;

export type UndoHandle = {
  id: string;
  /** Undo this specific entry, even if it is not at the top of the stack. */
  undo: (callbacks?: UndoCallbacks) => Promise<void>;
};

type UndoCallbacks = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
};

type MutationUndoContextValue = {
  pushUndo: (entry: UndoEntryInput) => UndoHandle;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  undo: (callbacks?: UndoCallbacks) => Promise<void>;
  redo: (callbacks?: UndoCallbacks) => Promise<void>;
};

const genId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const [MutationUndoProvider, useMutationUndoContext] =
  createAssertedContextProvider(
    'MutationUndo',
    (): MutationUndoContextValue => {
      const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
      const [redoStack, setRedoStack] = createSignal<UndoEntry[]>([]);

      const runUndo = async (
        entry: UndoEntry,
        callbacks?: UndoCallbacks
      ): Promise<void> => {
        const current = undoStack();
        const prevPos = current.indexOf(entry);
        // Already removed (e.g. handle.undo() called twice, or entry was
        // cleared by a new pushUndo after redoStack reset).
        if (prevPos < 0) return;

        setUndoStack(current.filter((e) => e !== entry));
        try {
          await entry.undo();
          if (entry.redo) {
            setRedoStack((prev) => [...prev, entry]);
          }
          entry.onUndone?.();
          callbacks?.onSuccess?.();
        } catch (err) {
          // Restore at original position so a non-top undo that fails doesn't
          // reorder the stack.
          setUndoStack((prev) => {
            const next = [...prev];
            next.splice(Math.min(prevPos, next.length), 0, entry);
            return next;
          });
          callbacks?.onError?.(
            err instanceof Error ? err : new Error(String(err))
          );
        } finally {
          callbacks?.onSettled?.();
        }
      };

      const runRedo = async (
        entry: UndoEntry,
        callbacks?: UndoCallbacks
      ): Promise<void> => {
        try {
          if (entry.redo) {
            await entry.redo();
          }
          setUndoStack((prev) => [...prev, entry]);
          entry.onRedone?.();
          callbacks?.onSuccess?.();
        } catch (err) {
          setRedoStack((prev) => [...prev, entry]);
          callbacks?.onError?.(
            err instanceof Error ? err : new Error(String(err))
          );
        } finally {
          callbacks?.onSettled?.();
        }
      };

      return {
        pushUndo: (input) => {
          const entry: UndoEntry = { ...input, id: genId() };
          setUndoStack((prev) => [...prev, entry]);
          setRedoStack([]);
          return {
            id: entry.id,
            undo: (callbacks) => runUndo(entry, callbacks),
          };
        },

        canUndo: () => undoStack().length > 0,
        canRedo: () => redoStack().length > 0,

        clear: () => {
          setUndoStack([]);
          setRedoStack([]);
        },

        undo: async (callbacks) => {
          const entry = undoStack().at(-1);
          if (!entry) return;
          await runUndo(entry, callbacks);
        },

        redo: async (callbacks) => {
          const stack = redoStack();
          const entry = stack.at(-1);
          if (!entry) return;
          setRedoStack(stack.slice(0, -1));
          await runRedo(entry, callbacks);
        },
      };
    }
  );

export type UndoLifecycle = {
  onUndone?: () => void;
  onRedone?: () => void;
};

export function useUndoableMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: () => MutationOptions<TData, TError, TVariables, TContext> & {
    undoFn?: UndoHandler<TVariables, TContext>;
    redoFn?: UndoHandler<TVariables, TContext>;
    undoLabel?: string;
    /** Fires after the entry is pushed onto the undo stack. Returned
     *  lifecycle hooks (onUndone/onRedone) will run on this specific
     *  entry — regardless of whether it is undone via the returned
     *  handle, the global LIFO `ctx.undo()`, or by a later `ctx.redo()`. */
    onPushed?: (
      handle: UndoHandle,
      variables: TVariables,
      context: TContext | undefined
    ) => UndoLifecycle | void;
  }
) {
  const { pushUndo } = useMutationUndoContext();

  return useMutation(() => {
    const { undoFn, redoFn, undoLabel, onPushed, onSuccess, ...opts } =
      options();
    return {
      ...opts,
      onSuccess: (data, variables, context, mutation) => {
        if (undoFn) {
          const lifecycleRef: { current?: UndoLifecycle } = {};
          const handle = pushUndo({
            undo: () => undoFn(variables, context),
            redo: redoFn ? () => redoFn(variables, context) : undefined,
            label: undoLabel,
            onUndone: () => lifecycleRef.current?.onUndone?.(),
            onRedone: () => lifecycleRef.current?.onRedone?.(),
          });
          lifecycleRef.current =
            onPushed?.(handle, variables, context) ?? undefined;
        }
        onSuccess?.(data, variables, context, mutation);
      },
    };
  });
}
