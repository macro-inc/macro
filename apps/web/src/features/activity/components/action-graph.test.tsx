import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeholderOverview } from '../core/placeholder-overview';
import { ActionGraph } from './action-graph';

// jsdom has no ResizeObserver and no layout; `weekAreaPx` is what the graph's
// week area measures.
const layout = { weekAreaPx: 0 };

beforeEach(() => {
  layout.weekAreaPx = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({
      width: layout.weekAreaPx,
      height: 0,
      top: 0,
      left: 0,
      right: layout.weekAreaPx,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const overview = placeholderOverview(new Date('2026-09-06T12:00:00Z'));
const days = (root: ParentNode) =>
  root.querySelectorAll('[data-activity-day]').length;

describe('ActionGraph', () => {
  it('shows the trailing weeks that fit the measured week area', () => {
    // 20 columns of 12px with 3px gaps: 20 * 15 - 3.
    layout.weekAreaPx = 297;
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(days(container)).toBe(20 * 7);
    expect(
      container.querySelector('[data-activity-heatmap-weeks]')?.className
    ).toContain('h-[102px]');
  });

  it('shows the whole year when the week area is wide enough', () => {
    layout.weekAreaPx = 900;
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(days(container)).toBeGreaterThan(300);
    expect(days(container) % 7).toBe(0);
  });

  it('paints no cells before it has been measured', () => {
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(days(container)).toBe(0);
    expect(
      container.querySelector('[data-activity-heatmap-weeks]')?.className
    ).toContain('h-[102px]');
  });

  it('lets a caller fix the column count, in skeleton mode too', () => {
    const { container } = render(() => (
      <ActionGraph overview={overview} maxWeeks={12} skeleton />
    ));
    expect(days(container)).toBe(12 * 7);
    expect(container.textContent).not.toContain('(');
  });
});
