import { type MutationOptions, useMutation } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';

type UndoHandler<TVariables, TContext> = (
  variables: TVariables,
  context: TContext | undefined
) => Promise<void> | void;

type UndoEntry = {
  undo: () => Promise<void> | void;
  redo?: () => Promise<void> | void;
  label?: string;
};

const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
const [redoStack, setRedoStack] = createSignal<UndoEntry[]>([]);

export function pushUndo(entry: UndoEntry): void {
  setUndoStack((prev) => [...prev, entry]);
  setRedoStack([]);
}

export function canUndo(): boolean {
  return undoStack().length > 0;
}

export function canRedo(): boolean {
  return redoStack().length > 0;
}

export function clearUndoHistory(): void {
  setUndoStack([]);
  setRedoStack([]);
}

export async function undo(): Promise<void> {
  const stack = undoStack();
  const entry = stack.at(-1);
  if (!entry) return;

  setUndoStack(stack.slice(0, -1));
  await entry.undo();
  if (entry.redo) {
    setRedoStack((prev) => [...prev, entry]);
  }
}

export async function redo(): Promise<void> {
  const stack = redoStack();
  const entry = stack.at(-1);
  if (!entry) return;

  setRedoStack(stack.slice(0, -1));
  if (entry.redo) {
    await entry.redo();
  }
  setUndoStack((prev) => [...prev, entry]);
}

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
