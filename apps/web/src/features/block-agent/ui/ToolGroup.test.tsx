/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Index } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityLineStep } from './ActivityLine';
import { ToolGroup } from './ToolGroup';

vi.mock('@icon/system/regular/caret-right.svg', () => ({
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

const step = (
  id: string,
  label: string,
  status: ActivityLineStep['status'] = 'completed'
): ActivityLineStep => ({ id, label, status });

function mount(overrides?: {
  live?: boolean;
  defaultOpen?: boolean;
  failed?: number;
}) {
  const [live, setLive] = createSignal(overrides?.live ?? false);
  const [calls, setCalls] = createSignal(['Read', 'Edit', 'Shell']);
  const [steps, setSteps] = createSignal<ActivityLineStep[]>([
    step('read', 'Read a.rs'),
    step('edit', 'Edited a.rs'),
    step('shell', 'Running bun run check', 'running'),
  ]);
  const [summary, setSummary] = createSignal<string>();
  const view = render(() => (
    <ToolGroup
      count={calls().length}
      failed={overrides?.failed}
      live={live()}
      steps={steps()}
      summary={summary()}
      defaultOpen={overrides?.defaultOpen}
    >
      <Index each={calls()}>
        {(call) => <div data-testid="call">{call()}</div>}
      </Index>
    </ToolGroup>
  ));
  return { ...view, setLive, setCalls, setSteps, setSummary };
}

describe('ToolGroup', () => {
  it('starts a finished run collapsed to its count', () => {
    const view = mount();
    expect(view.getByRole('button').textContent).toBe('Used 3 tools');
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('counts failures on the finished row', () => {
    const view = mount({ failed: 2 });
    expect(view.getByRole('button').textContent).toBe(
      'Used 3 tools · 2 failed'
    );
  });

  it('is one live line naming the running step, and stays closed', () => {
    const view = mount({ live: true });
    const line = view.getByRole('status');
    expect(view.getByRole('button').contains(line)).toBe(true);
    expect(view.getByLabelText('Running bun run check')).toBeTruthy();
    expect(view.getByRole('button').textContent).not.toContain('tools');
    vi.advanceTimersByTime(5000);
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('moves the line to the next step, and to the last one between steps', () => {
    const view = mount({ live: true });
    view.setSteps([
      step('read', 'Read a.rs'),
      step('edit', 'Edited a.rs'),
      step('shell', 'Ran bun run check'),
      step('search', 'Searching apps/web', 'running'),
    ]);
    expect(view.getByLabelText('Searching apps/web')).toBeTruthy();
    expect(view.queryByLabelText('Running bun run check')).toBeNull();
    view.setSteps((steps) =>
      steps.map((item) => ({ ...item, status: 'completed' }))
    );
    expect(view.getByLabelText('Searching apps/web')).toBeTruthy();
  });

  it("puts the session's status line in place of the steps", () => {
    const view = mount({ live: true });
    view.setSummary('Checking the build');
    expect(view.getByLabelText('Checking the build')).toBeTruthy();
    expect(view.queryByLabelText('Running bun run check')).toBeNull();
  });

  it('keeps manual expansion while calls arrive and the run settles', () => {
    const view = mount({ live: true });
    view.getByRole('button').click();
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    const first = view.getAllByTestId('call')[0];
    view.setCalls((calls) => [...calls, 'Search']);
    expect(view.getAllByTestId('call')).toHaveLength(4);
    view.setLive(false);
    vi.advanceTimersByTime(2000);
    expect(view.getByRole('button').textContent).toBe('Used 4 tools');
    expect(view.getAllByTestId('call')).toHaveLength(4);
    expect(view.getAllByTestId('call')[0]).toBe(first);
    view.getByRole('button').click();
    expect(view.queryAllByTestId('call')).toHaveLength(0);
  });

  it('lists every call in full once opened, with no scrolling window', () => {
    const view = mount({ defaultOpen: true });
    const region = view.getByRole('region', { name: 'Tool calls' });
    expect(view.getAllByTestId('call')).toHaveLength(3);
    expect(region.id).toBe(
      view.getByRole('button').getAttribute('aria-controls')
    );
    expect(region.className).not.toMatch(/max-h|overflow/);
  });

  it('does not construct results for a historical collapsed group', () => {
    const bodyMounted = vi.fn();
    function Body() {
      bodyMounted();
      return <div>Expensive result</div>;
    }
    const view = render(() => (
      <ToolGroup count={2}>
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
      <ToolGroup count={1} open={open()} onOpenChange={onOpenChange}>
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

  it('shows the live line without a count beside it', () => {
    const view = render(() => (
      <ToolGroup count={6} live summary="Searching your workspace…">
        <div />
      </ToolGroup>
    ));
    const title = view.getByRole('button').textContent ?? '';
    expect(title).toContain('Searching your workspace…');
    expect(title).not.toMatch(/\d/);
  });
});
