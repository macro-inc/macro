import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { dotsAndBoxesRules } from '../core/games/dots-and-boxes';
import { DotsAndBoxesBoard } from './dots-and-boxes-board';

afterEach(cleanup);

describe('DotsAndBoxesBoard', () => {
  it('keeps each line element across moves, so keyboard focus survives', () => {
    const [state, setState] = createSignal(dotsAndBoxesRules.initial(2, 0));
    render(() => (
      <DotsAndBoxesBoard
        state={state()}
        canMove
        turnSeat={0}
        initials={['A', 'B']}
        onDraw={(move) =>
          setState(
            (current) => dotsAndBoxesRules.apply(current, move, 0) ?? current
          )
        }
      />
    ));
    const line = () =>
      screen.getByRole('button', { name: 'Draw vertical line 2' });
    const focused = line();
    focused.focus();

    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Draw horizontal line 1' }),
      { key: 'Enter' }
    );
    expect(state().horizontal[0]).toBe(0);
    expect(line()).toBe(focused);
    expect(document.activeElement).toBe(focused);
  });
});
