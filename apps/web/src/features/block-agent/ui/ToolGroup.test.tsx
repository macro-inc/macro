/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolGroup } from './ToolGroup';

vi.mock('@phosphor/dots-three.svg', () => ({
  default: () => <svg data-testid="dots" />,
}));

afterEach(cleanup);

function mount(count: number, active = false) {
  const indices = Array.from({ length: count }, (_, index) => index);
  return render(() => (
    <ToolGroup indices={indices} active={active}>
      {(index) => <div data-testid="call">call {index}</div>}
    </ToolGroup>
  ));
}

describe('ToolGroup', () => {
  it('shows every call of a short run, with nothing to expand', () => {
    const view = mount(5);
    expect(view.getAllByTestId('call')).toHaveLength(5);
    expect(view.queryByRole('button')).toBeNull();
  });

  it('folds the middle of a long settled run, keeping both ends', () => {
    const view = mount(9);
    const shown = view.getAllByTestId('call').map((el) => el.textContent);
    expect(shown).toEqual(['call 0', 'call 1', 'call 7', 'call 8']);
    expect(view.getByRole('button').textContent).toContain('5 more tools');
  });

  it('opens the fold in place, keeping the rows that were already shown', () => {
    const view = mount(9);
    const first = view.getAllByTestId('call')[0];
    view.getByRole('button').click();
    expect(view.getAllByTestId('call')).toHaveLength(9);
    expect(view.queryByRole('button')).toBeNull();
    // The rows at the ends are the same elements, so a card open inside one
    // of them stays open when the middle unfolds.
    expect(view.getAllByTestId('call')[0]).toBe(first);
  });

  it('never folds a run with a call still in flight', () => {
    const view = mount(9, true);
    expect(view.getAllByTestId('call')).toHaveLength(9);
    expect(view.queryByRole('button')).toBeNull();
  });
});
