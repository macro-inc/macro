/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Index } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolGroup } from './ToolGroup';

vi.mock('@phosphor/caret-right.svg', () => ({
  default: () => <svg data-testid="caret" />,
}));

let animationDefaults: HTMLStyleElement;

beforeEach(() => {
  // jsdom's absent CSS reports an empty animation name. Browser styles report
  // "none" when animation is disabled; Kobalte uses it to finish presence.
  animationDefaults = document.createElement('style');
  animationDefaults.textContent = '* { animation-name: none; }';
  document.head.append(animationDefaults);
});

afterEach(() => {
  cleanup();
  animationDefaults.remove();
});

function mount(overrides?: { active?: boolean; defaultOpen?: boolean }) {
  const [active, setActive] = createSignal(overrides?.active ?? false);
  const [calls, setCalls] = createSignal(['Read', 'Edit', 'Shell']);
  const view = render(() => (
    <ToolGroup
      count={calls().length}
      active={active()}
      defaultOpen={overrides?.defaultOpen}
    >
      <Index each={calls()}>
        {(call) => <div data-testid="call">{call()}</div>}
      </Index>
    </ToolGroup>
  ));
  return { ...view, setActive, setCalls };
}

describe('ToolGroup', () => {
  it('starts historical groups collapsed with just the count', () => {
    const view = mount();
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('starts an active group collapsed and keeps arriving calls hidden', () => {
    const view = mount({ active: true });
    expect(view.getByRole('button').textContent).toContain('Calling 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
    view.setCalls((calls) => [...calls, 'Search']);
    expect(view.getByRole('button').textContent).toContain('Calling 4 tools');
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('keeps manual expansion until the reader closes the group', () => {
    const view = mount({ active: true });
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByTestId('call')).toHaveLength(3);
    view.setCalls((calls) => [...calls, 'Search']);
    view.setActive(false);
    expect(view.getByRole('button').textContent).toContain('Called 4 tools');
    expect(view.getAllByTestId('call')).toHaveLength(4);
    view.getByRole('button').click();
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('settles the shimmer immediately without opening', () => {
    const view = mount({ active: true });
    view.setActive(false);
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('supports an initially expanded static example', () => {
    const view = mount({ defaultOpen: true });
    expect(view.getAllByTestId('call')).toHaveLength(3);
  });

  it('does not construct results for a collapsed group', () => {
    const bodyMounted = vi.fn();
    function Body() {
      bodyMounted();
      return <div>Expensive result</div>;
    }
    const view = render(() => (
      <ToolGroup count={2} active>
        <Body />
      </ToolGroup>
    ));
    expect(bodyMounted).not.toHaveBeenCalled();
    view.getByRole('button').click();
    expect(bodyMounted).toHaveBeenCalledOnce();
  });
});
