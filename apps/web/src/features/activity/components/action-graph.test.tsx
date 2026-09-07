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

// Monday 2026-09-07: the window opens on a Tuesday and ends mid-week, so the
// year spans 53 columns including both partial weeks.
const overview = placeholderOverview(new Date('2026-09-07T12:00:00Z'));
const days = (root: ParentNode) =>
  root.querySelectorAll('[data-activity-day]').length;
const heatmapStyle = (root: ParentNode) =>
  (root.querySelector('[data-activity-heatmap]') as HTMLElement).style;

describe('ActionGraph', () => {
  it('renders every week of the year including the partial ones', () => {
    layout.weekAreaPx = 900;
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(days(container)).toBe(365);
    expect(
      container.querySelectorAll('[data-activity-heatmap-weeks] > div > div')
    ).toHaveLength(53);
  });

  it('takes the full cell size in a wide pane', () => {
    layout.weekAreaPx = 900;
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(heatmapStyle(container).getPropertyValue('--heatmap-cell')).toBe(
      '12px'
    );
    expect(heatmapStyle(container).getPropertyValue('--heatmap-gap')).toBe(
      '3px'
    );
  });

  it('shrinks the cells in a narrow pane and keeps every week', () => {
    layout.weekAreaPx = 336;
    const { container } = render(() => <ActionGraph overview={overview} />);
    expect(days(container)).toBe(365);
    expect(heatmapStyle(container).getPropertyValue('--heatmap-cell')).toBe(
      '8px'
    );
    expect(heatmapStyle(container).getPropertyValue('--heatmap-gap')).toBe(
      '2px'
    );
  });

  it('renders the skeleton with the same columns and no numbers', () => {
    layout.weekAreaPx = 900;
    const { container } = render(() => (
      <ActionGraph overview={overview} skeleton />
    ));
    expect(days(container)).toBe(365);
    expect(container.textContent).not.toContain('(');
  });
});
