/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveToolGroup as ToolGroup } from './LiveToolGroup';

vi.mock('@phosphor/caret-right.svg', () => ({
  default: () => <svg data-testid="caret" />,
}));

beforeEach(() => {
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
  return render(() => (
    <ToolGroup
      count={3}
      active={overrides?.active ?? false}
      defaultOpen={overrides?.defaultOpen}
    >
      <div data-testid="call">Read</div>
      <div data-testid="call">Edit</div>
      <div data-testid="call">Bash</div>
    </ToolGroup>
  ));
}

describe('LiveToolGroup', () => {
  it('starts historical groups closed with just the count', () => {
    const view = mount();
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('opens and closes the calls on click', () => {
    const view = mount();
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByTestId('call')).toHaveLength(3);
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

  it('never opens a hundred calls that finish in the initial buffer', () => {
    vi.useFakeTimers();
    const [active, setActive] = createSignal(true);
    const view = render(() => (
      <ToolGroup count={100} active={active()}>
        <div data-testid="calls">100 calls</div>
      </ToolGroup>
    ));
    vi.advanceTimersByTime(20);
    setActive(false);
    vi.advanceTimersByTime(1000);
    expect(view.queryByTestId('calls')).toBeNull();
    expect(view.getByRole('button').textContent).toContain('Called 100 tools');
  });

  it('holds an opened run, then collapses without delaying its completion status', () => {
    vi.useFakeTimers();
    const [active, setActive] = createSignal(true);
    const view = render(() => (
      <ToolGroup count={3} active={active()}>
        <div data-testid="calls">calls</div>
      </ToolGroup>
    ));
    vi.advanceTimersByTime(150);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    setActive(false);
    expect(view.getByRole('button').textContent).toContain('Called 3 tools');
    vi.advanceTimersByTime(599);
    expect(view.getByTestId('calls')).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('keeps manually opened history open while calls arrive and settle', () => {
    vi.useFakeTimers();
    const [active, setActive] = createSignal(false);
    const view = render(() => (
      <ToolGroup count={3} active={active()}>
        <div data-testid="calls">calls</div>
      </ToolGroup>
    ));
    view.getByRole('button').click();
    const calls = view.getByTestId('calls');
    setActive(true);
    vi.advanceTimersByTime(200);
    setActive(false);
    vi.advanceTimersByTime(1000);
    expect(view.getByTestId('calls')).toBe(calls);
    expect(view.getByRole('region', { name: 'Tool calls' }).id).toBe(
      view.getByRole('button').getAttribute('aria-controls')
    );
  });

  it('keeps keyboard inspection open after the calls finish', () => {
    vi.useFakeTimers();
    const [active, setActive] = createSignal(true);
    const view = render(() => (
      <ToolGroup count={1} active={active()}>
        <button type="button">Inspect result</button>
      </ToolGroup>
    ));
    vi.advanceTimersByTime(150);
    view.getByRole('button', { name: 'Inspect result' }).focus();
    setActive(false);
    vi.advanceTimersByTime(1000);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Inspect result' })
    );
  });
});
