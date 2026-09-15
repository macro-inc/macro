/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolGroup } from './ToolGroup';

vi.mock('@phosphor/caret-right.svg', () => ({
  default: () => <svg data-testid="caret" />,
}));

afterEach(cleanup);

function mount(overrides?: { active?: boolean; defaultOpen?: boolean }) {
  return render(() => (
    <ToolGroup
      count={3}
      active={overrides?.active ?? false}
      defaultOpen={overrides?.defaultOpen}
      latest={{ label: 'Bash', detail: 'cargo test -p agent_fold' }}
    >
      <div data-testid="call">Read</div>
      <div data-testid="call">Edit</div>
      <div data-testid="call">Bash</div>
    </ToolGroup>
  ));
}

describe('ToolGroup', () => {
  it('starts closed, counting the calls and naming the latest one', () => {
    const view = mount();
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.container.textContent).toContain('Bash');
    expect(view.container.textContent).toContain('cargo test -p agent_fold');
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('opens on click, swapping the latest line for the calls', () => {
    const view = mount();
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByTestId('call')).toHaveLength(3);
    expect(view.container.textContent).not.toContain(
      'cargo test -p agent_fold'
    );
    view.getByRole('button').click();
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('reads as in progress while a call is still running', () => {
    const view = mount({ active: true });
    expect(view.getByRole('button').textContent).toContain('Calling 3 tools');
  });

  it('can start open', () => {
    const view = mount({ defaultOpen: true });
    expect(view.getAllByTestId('call')).toHaveLength(3);
  });
});
