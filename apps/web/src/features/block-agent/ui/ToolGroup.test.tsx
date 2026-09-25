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
  vi.useFakeTimers();
  // jsdom's absent CSS reports an empty animation name. Browser styles report
  // "none" when animation is disabled; Kobalte uses it to finish presence.
  animationDefaults = document.createElement('style');
  animationDefaults.textContent = '* { animation-name: none; }';
  document.head.append(animationDefaults);
});

afterEach(() => {
  cleanup();
  animationDefaults.remove();
  vi.useRealTimers();
});

function mount(overrides?: {
  active?: boolean;
  live?: boolean;
  defaultOpen?: boolean;
}) {
  const [active, setActive] = createSignal(overrides?.active ?? false);
  const [live, setLive] = createSignal(overrides?.live);
  const [calls, setCalls] = createSignal(['Read', 'Edit', 'Shell']);
  const view = render(() => (
    <ToolGroup
      count={calls().length}
      active={active()}
      live={live()}
      defaultOpen={overrides?.defaultOpen}
    >
      <Index each={calls()}>
        {(call) => <div data-testid="call">{call()}</div>}
      </Index>
    </ToolGroup>
  ));
  return { ...view, setActive, setLive, setCalls };
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

  it('keeps manual expansion of historical groups until the reader closes them', () => {
    const view = mount();
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByTestId('call')).toHaveLength(3);
    vi.advanceTimersByTime(2000);
    expect(view.getAllByTestId('call')).toHaveLength(3);
    view.getByRole('button').click();
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('starts an active group open and collects arriving calls in place', () => {
    const view = mount({ active: true });
    const first = view.getAllByTestId('call')[0];
    expect(view.getByRole('button').textContent).toContain('Calling 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    view.setCalls((calls) => [...calls, 'Search']);
    expect(view.getAllByTestId('call')).toHaveLength(4);
    expect(view.getAllByTestId('call')[0]).toBe(first);
    vi.advanceTimersByTime(2000);
    expect(view.getAllByTestId('call')).toHaveLength(4);
  });

  it('settles the shimmer immediately and collapses after a readable pause', () => {
    const view = mount({ active: true });
    view.setActive(false);
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(699);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(1);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('bridges quick gaps between calls and cancels the earlier collapse', () => {
    const view = mount({ active: true });
    const first = view.getAllByTestId('call')[0];
    view.setActive(false);
    vi.advanceTimersByTime(500);
    view.setCalls((calls) => [...calls, 'Search']);
    view.setActive(true);
    vi.advanceTimersByTime(500);
    expect(view.getAllByTestId('call')[0]).toBe(first);
    view.setActive(false);
    vi.advanceTimersByTime(699);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    vi.advanceTimersByTime(1);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('briefly reveals completed calls arriving in a live batch', () => {
    const view = mount({ live: true });
    expect(view.getAllByTestId('call')).toHaveLength(3);
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    vi.advanceTimersByTime(700);
    expect(view.queryAllByTestId('call')).toHaveLength(0);
    view.setCalls((calls) => [...calls, 'Search', 'Read']);
    expect(view.getAllByTestId('call')).toHaveLength(5);
    vi.advanceTimersByTime(700);
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('preserves manually reopened results after automatic collapse', () => {
    const view = mount({ active: true });
    view.setActive(false);
    vi.advanceTimersByTime(700);
    view.getByRole('button').click();
    vi.advanceTimersByTime(2000);
    expect(view.getAllByTestId('call')).toHaveLength(3);
  });

  it('supports an initially expanded static example', () => {
    const view = mount({ defaultOpen: true });
    vi.advanceTimersByTime(2000);
    expect(view.getAllByTestId('call')).toHaveLength(3);
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

  it('clears pending collapse work on unmount', () => {
    const view = mount({ active: true });
    view.setActive(false);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
