import { describe, expect, it, beforeEach } from 'vitest';
import {
  canRedo,
  canUndo,
  clearUndoHistory,
  pushUndo,
  redo,
  undo,
} from './undo';

describe('undo stack', () => {
  beforeEach(() => {
    clearUndoHistory();
  });

  it('pushes, undoes, and redoes entries', async () => {
    let undoCalls = 0;
    let redoCalls = 0;

    pushUndo({
      undo: () => {
        undoCalls += 1;
      },
      redo: () => {
        redoCalls += 1;
      },
    });

    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    await undo();

    expect(undoCalls).toBe(1);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    await redo();

    expect(redoCalls).toBe(1);
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it('clears redo history when a new undo is pushed', async () => {
    let redoCalls = 0;

    pushUndo({
      undo: () => {},
      redo: () => {
        redoCalls += 1;
      },
    });

    await undo();
    expect(canRedo()).toBe(true);

    pushUndo({
      undo: () => {},
    });

    expect(canRedo()).toBe(false);
    await redo();
    expect(redoCalls).toBe(0);
  });

  it('no-ops when stacks are empty', async () => {
    await undo();
    await redo();

    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});
