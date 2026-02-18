/**
 * Undo/redo support for mutations.
 *
 * @example
 * // 1. Wrap your app with the provider
 * <MutationUndoProvider>
 *   <App />
 * </MutationUndoProvider>
 *
 * // 2. Use undoable mutations
 * const updateItem = useUndoableMutation(() => ({
 *   mutationFn: (data) => api.update(data.id, data.value),
 *   undoFn: (variables) => api.update(variables.id, variables.previousValue),
 *   redoFn: (variables) => api.update(variables.id, variables.value),
 * }));
 *
 * // 3. Trigger undo/redo with callbacks
 * const { undo, redo, canUndo, canRedo } = useMutationUndoContext();
 * await undo({
 *   onSuccess: () => toast.success('Undone'),
 *   onError: (err) => toast.error(err.message),
 * });
 */

import { type MutationOptions, useMutation } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { createAssertedContextProvider } from '@core/context/createContext';

type UndoHandler<TVariables, TContext> = (
  variables: TVariables,
  context: TContext | undefined
) => Promise<void> | void;

type UndoEntry = {
  undo: () => Promise<void> | void;
  redo?: () => Promise<void> | void;
  label?: string;
};

type UndoCallbacks = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
};

type MutationUndoContextValue = {
  pushUndo: (entry: UndoEntry) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  undo: (callbacks?: UndoCallbacks) => Promise<void>;
  redo: (callbacks?: UndoCallbacks) => Promise<void>;
};

export const [MutationUndoProvider, useMutationUndoContext] =
  createAssertedContextProvider(
    'MutationUndo',
    (): MutationUndoContextValue => {
      const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
      const [redoStack, setRedoStack] = createSignal<UndoEntry[]>([]);

      return {
        pushUndo: (entry) => {
          setUndoStack((prev) => [...prev, entry]);
          setRedoStack([]);
        },

        canUndo: () => undoStack().length > 0,
        canRedo: () => redoStack().length > 0,

        clear: () => {
          setUndoStack([]);
          setRedoStack([]);
        },

        undo: async (callbacks?: UndoCallbacks) => {
          const stack = undoStack();
          const entry = stack.at(-1);
          if (!entry) return;

          setUndoStack(stack.slice(0, -1));
          try {
            await entry.undo();
            if (entry.redo) {
              setRedoStack((prev) => [...prev, entry]);
            }
            callbacks?.onSuccess?.();
          } catch (err) {
            setUndoStack((prev) => [...prev, entry]);
            callbacks?.onError?.(
              err instanceof Error ? err : new Error(String(err))
            );
          } finally {
            callbacks?.onSettled?.();
          }
        },

        redo: async (callbacks?: UndoCallbacks) => {
          const stack = redoStack();
          const entry = stack.at(-1);
          if (!entry) return;

          setRedoStack(stack.slice(0, -1));
          try {
            if (entry.redo) {
              await entry.redo();
            }
            setUndoStack((prev) => [...prev, entry]);
            callbacks?.onSuccess?.();
          } catch (err) {
            setRedoStack((prev) => [...prev, entry]);
            callbacks?.onError?.(
              err instanceof Error ? err : new Error(String(err))
            );
          } finally {
            callbacks?.onSettled?.();
          }
        },
      };
    }
  );

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
  }
) {
  const { pushUndo } = useMutationUndoContext();

  return useMutation(() => {
    const { undoFn, redoFn, undoLabel, onSuccess, ...opts } = options();
    return {
      ...opts,
      onSuccess: (data, variables, context, mutation) => {
        if (undoFn) {
          pushUndo({
            undo: () => undoFn(variables, context),
            redo: redoFn ? () => redoFn(variables, context) : undefined,
            label: undoLabel,
          });
        }
        onSuccess?.(data, variables, context, mutation);
      },
    };
  });
}
