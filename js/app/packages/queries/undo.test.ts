import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { MutationUndoProvider, useMutationUndoContext } from './undo';

describe('MutationUndoProvider', () => {
  it('pushes, undoes, and redoes entries', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      let undoCalls = 0;
      let redoCalls = 0;

      ctx.pushUndo({
        undo: () => {
          undoCalls += 1;
        },
        redo: () => {
          redoCalls += 1;
        },
      });

      expect(ctx.canUndo()).toBe(true);
      expect(ctx.canRedo()).toBe(false);

      await ctx.undo();

      expect(undoCalls).toBe(1);
      expect(ctx.canUndo()).toBe(false);
      expect(ctx.canRedo()).toBe(true);

      await ctx.redo();

      expect(redoCalls).toBe(1);
      expect(ctx.canUndo()).toBe(true);
      expect(ctx.canRedo()).toBe(false);

      dispose();
    });
  });

  it('clears redo history when a new undo is pushed', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      let redoCalls = 0;

      ctx.pushUndo({
        undo: () => {},
        redo: () => {
          redoCalls += 1;
        },
      });

      await ctx.undo();
      expect(ctx.canRedo()).toBe(true);

      ctx.pushUndo({
        undo: () => {},
      });

      expect(ctx.canRedo()).toBe(false);
      await ctx.redo();
      expect(redoCalls).toBe(0);

      dispose();
    });
  });

  it('no-ops when stacks are empty', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      await ctx.undo();
      await ctx.redo();

      expect(ctx.canUndo()).toBe(false);
      expect(ctx.canRedo()).toBe(false);

      dispose();
    });
  });

  it('throws when useMutationUndoContext is called outside provider', () => {
    expect(() => {
      createRoot(() => {
        useMutationUndoContext();
      });
    }).toThrow('MutationUndo must be used within <MutationUndoProvider />');
  });

  it('calls onSuccess and onSettled callbacks on successful undo', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      let successCalled = false;
      let settledCalled = false;

      ctx.pushUndo({ undo: () => {} });

      await ctx.undo({
        onSuccess: () => {
          successCalled = true;
        },
        onSettled: () => {
          settledCalled = true;
        },
      });

      expect(successCalled).toBe(true);
      expect(settledCalled).toBe(true);

      dispose();
    });
  });

  it('calls onError and onSettled callbacks on failed undo and restores stack', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      let errorCalled = false;
      let settledCalled = false;
      let capturedError: Error | undefined;

      ctx.pushUndo({
        undo: () => {
          throw new Error('undo failed');
        },
      });

      expect(ctx.canUndo()).toBe(true);

      await ctx.undo({
        onError: (err) => {
          errorCalled = true;
          capturedError = err;
        },
        onSettled: () => {
          settledCalled = true;
        },
      });

      expect(errorCalled).toBe(true);
      expect(settledCalled).toBe(true);
      expect(capturedError?.message).toBe('undo failed');
      // Stack should be restored after failure
      expect(ctx.canUndo()).toBe(true);

      dispose();
    });
  });

  it('calls onError on failed redo and restores stack', async () => {
    await createRoot(async (dispose) => {
      let ctx!: ReturnType<typeof useMutationUndoContext>;

      MutationUndoProvider({
        get children() {
          ctx = useMutationUndoContext();
          return null;
        },
      });

      let errorCalled = false;

      ctx.pushUndo({
        undo: () => {},
        redo: () => {
          throw new Error('redo failed');
        },
      });

      await ctx.undo();
      expect(ctx.canRedo()).toBe(true);

      await ctx.redo({
        onError: () => {
          errorCalled = true;
        },
      });

      expect(errorCalled).toBe(true);
      // Stack should be restored after failure
      expect(ctx.canRedo()).toBe(true);

      dispose();
    });
  });
});
