/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Index } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolGroup } from './ToolGroup';

vi.mock('@phosphor/caret-right.svg', () => ({
  default: () => <svg data-testid="caret" />,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    vi.advanceTimersByTime(2000);
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('keeps manual expansion while calls arrive and settle', () => {
    const view = mount();
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    const first = view.getAllByTestId('call')[0];
    view.setActive(true);
    view.setCalls((calls) => [...calls, 'Search']);
    expect(view.getByRole('button').textContent).toContain('Calling 4 tools');
    expect(view.getAllByTestId('call')[0]).toBe(first);
    view.setActive(false);
    vi.advanceTimersByTime(2000);
    expect(view.getByRole('button').textContent).toContain('Called 4 tools');
    expect(view.getAllByTestId('call')).toHaveLength(4);
    expect(view.getAllByTestId('call')[0]).toBe(first);
    view.getByRole('button').click();
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('leaves automatic opening to its owner', () => {
    const view = mount({ active: true });
    expect(view.getByRole('button').textContent).toContain('Calling 3 tools');
    vi.advanceTimersByTime(2000);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('supports an initially expanded static example', () => {
    const view = mount({ defaultOpen: true });
    vi.advanceTimersByTime(2000);
    expect(view.getAllByTestId('call')).toHaveLength(3);
    expect(view.getByRole('region', { name: 'Tool calls' }).id).toBe(
      view.getByRole('button').getAttribute('aria-controls')
    );
  });

  it('does not construct results for a historical collapsed group', () => {
    const bodyMounted = vi.fn();
    function Body() {
      bodyMounted();
      return <div>Expensive result</div>;
    }
    const view = render(() => (
      <ToolGroup count={2} active={false}>
        <Body />
      </ToolGroup>
    ));
    expect(bodyMounted).not.toHaveBeenCalled();
    view.getByRole('button').click();
    expect(bodyMounted).toHaveBeenCalledOnce();
  });

  it('reports disclosure requests and waits for controlled state updates', () => {
    const [open, setOpen] = createSignal(false);
    const onOpenChange = vi.fn();
    const view = render(() => (
      <ToolGroup
        count={1}
        active={false}
        open={open()}
        onOpenChange={onOpenChange}
      >
        <div data-testid="call">Read</div>
      </ToolGroup>
    ));
    const trigger = view.getByRole('button');
    trigger.click();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByTestId('call')).toBeNull();

    setOpen(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByTestId('call')).toBeTruthy();
    trigger.click();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    setOpen(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByTestId('call')).toBeNull();
  });
});
