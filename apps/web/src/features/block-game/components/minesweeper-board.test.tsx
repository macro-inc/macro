import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMinesweeper,
  type MinesweeperState,
} from '../core/games/minesweeper';
import { MinesweeperBoard } from './minesweeper-board';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBoard(state: MinesweeperState, onFlag: () => void) {
  return render(() => (
    <MinesweeperBoard
      state={state}
      flagMode={false}
      disabled={false}
      onReveal={() => {}}
      onFlag={onFlag}
      onChord={() => {}}
    />
  ));
}

/** Start a touch press on the first hidden cell (jsdom lacks PointerEvent). */
function longPress() {
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  screen.getAllByRole('button', { name: 'Hidden' })[0].dispatchEvent(event);
}

describe('MinesweeperBoard', () => {
  it('flags with a long press only while the game runs', () => {
    vi.useFakeTimers();
    const onFlag = vi.fn();
    renderBoard(createMinesweeper(3, 3, 1), onFlag);
    longPress();
    vi.advanceTimersByTime(500);
    expect(onFlag).toHaveBeenCalledTimes(1);
    cleanup();

    renderBoard({ ...createMinesweeper(3, 3, 1), status: 'lost' }, onFlag);
    longPress();
    vi.advanceTimersByTime(500);
    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  it('drops a pending long press when the board goes away', () => {
    vi.useFakeTimers();
    const onFlag = vi.fn();
    const { unmount } = renderBoard(createMinesweeper(3, 3, 1), onFlag);
    longPress();
    unmount();
    vi.advanceTimersByTime(500);
    expect(onFlag).not.toHaveBeenCalled();
  });
});
