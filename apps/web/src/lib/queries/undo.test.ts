import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
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

  for (const failure of [false, true]) {
    it.each([false, true])(
      `retires an in-flight redo after a new action (failure=${failure}, newer undone=%s)`,
      async (undoNewer) => {
        await createRoot(async (dispose) => {
          let ctx!: ReturnType<typeof useMutationUndoContext>;
          MutationUndoProvider({
            get children() {
              ctx = useMutationUndoContext();
              return null;
            },
          });
          const pending = Promise.withResolvers<void>();
          const oldUndo = vi.fn();
          const onRedone = vi.fn();
          ctx.pushUndo({
            undo: oldUndo,
            redo: () => pending.promise,
            onRedone,
          });
          await ctx.undo();
          oldUndo.mockClear();
          const callbacks = {
            onSuccess: vi.fn(),
            onError: vi.fn(),
            onSettled: vi.fn(),
          };
          const redo = ctx.redo(callbacks);
          const newerUndo = vi.fn();
          const newerRedo = vi.fn();
          ctx.pushUndo({ undo: newerUndo, redo: newerRedo });
          if (undoNewer) await ctx.undo();
          if (failure) pending.reject(new Error('old redo failed'));
          else pending.resolve();
          await redo;
          expect(onRedone).not.toHaveBeenCalled();
          expect(callbacks.onSuccess).not.toHaveBeenCalled();
          expect(callbacks.onError).not.toHaveBeenCalled();
          expect(callbacks.onSettled).toHaveBeenCalledOnce();
          if (undoNewer) {
            expect(ctx.canUndo()).toBe(false);
            await ctx.redo();
            expect(newerRedo).toHaveBeenCalledOnce();
            await ctx.undo();
          } else {
            expect(ctx.canRedo()).toBe(false);
            await ctx.undo();
          }
          expect(newerUndo).toHaveBeenCalledTimes(undoNewer ? 2 : 1);
          expect(oldUndo).not.toHaveBeenCalled();
          expect(ctx.canUndo()).toBe(false);
          dispose();
        });
      }
    );
  }

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

  for (const operation of ['undo', 'redo'] as const) {
    for (const retire of ['dispose', 'clear'] as const) {
      it.each([false, true])(
        `does not resurrect a pending ${operation} after ${retire} (failure=%s)`,
        async (failure) => {
          await createRoot(async (dispose) => {
            let ctx!: ReturnType<typeof useMutationUndoContext>;
            MutationUndoProvider({
              get children() {
                ctx = useMutationUndoContext();
                return null;
              },
            });
            const pending = Promise.withResolvers<void>();
            const onUndone = vi.fn();
            const onRedone = vi.fn();
            const handle = ctx.pushUndo({
              undo: () => (operation === 'undo' ? pending.promise : undefined),
              redo: () => pending.promise,
              onUndone,
              onRedone,
            });
            if (operation === 'redo') await ctx.undo();
            onUndone.mockClear();
            const action = ctx[operation]();
            if (retire === 'dispose') handle.dispose();
            else ctx.clear();
            if (failure) pending.reject(new Error('failed'));
            else pending.resolve();
            await action;
            expect(ctx.canUndo()).toBe(false);
            expect(ctx.canRedo()).toBe(false);
            expect(onUndone).not.toHaveBeenCalled();
            expect(onRedone).not.toHaveBeenCalled();
            dispose();
          });
        }
      );
    }
  }

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
