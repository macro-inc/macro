/**
 * @vitest-environment jsdom
 */

import { TOKENS } from '@core/hotkey/tokens';
import { fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarItem } from './links';
import { SplitNavRail } from './split-rail';

const mocks = vi.hoisted(() => ({
  links: [] as SidebarItem[],
  /** Split ids the layout is currently laying out as side panels. */
  sideSplitIds: new Set<string>(),
  /** Content already open, by `type:id`, with the split id showing it. */
  openSplits: new Map<string, string>(),
  canFit: true,
  close: vi.fn(),
  createNewSplit: vi.fn(),
  markSideSplit: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: (type: string, id: string) => {
      const splitId = mocks.openSplits.get(`${type}:${id}`);
      return splitId === undefined
        ? undefined
        : { id: splitId, close: mocks.close };
    },
    resizeContext: () => ({ canFit: () => mocks.canFit }),
    createNewSplit: mocks.createNewSplit,
  }),
}));

vi.mock('@components/app/split-layout/side-split-sizing', () => ({
  SIDE_SPLIT_MIN_WIDTH: 250,
  isSideSplit: (id: string) => mocks.sideSplitIds.has(id),
  markSideSplit: mocks.markSideSplit,
}));

vi.mock('./links', () => ({
  useSidebarLinks: () => () => mocks.links,
}));

vi.mock('./rail-parts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./rail-parts')>();
  return { ...original, useRailUnreadCounts: () => () => new Map() };
});

vi.mock('@ui', () => {
  type MockButtonProps = {
    children?: JSX.Element;
    label?: string;
    onMouseDown?: (event: MouseEvent) => void;
    'data-active'?: string;
    'data-rail-link'?: string;
  };

  const Button = (props: MockButtonProps) => (
    <button
      type="button"
      aria-label={props.label}
      data-active={props['data-active']}
      data-rail-link={props['data-rail-link']}
      onMouseDown={(event) => props.onMouseDown?.(event)}
    >
      {props.children}
    </button>
  );

  return { Button, cn: (...args: unknown[]) => args.filter(Boolean).join(' ') };
});

function link(id: string, label: string): SidebarItem {
  return {
    id,
    label,
    href: `/${id}`,
    hotkey: 'i',
    hotkeyToken: TOKENS.sidebar.goTo.inbox,
  };
}

function clickDestination(container: HTMLElement, linkId: string) {
  const target = container.querySelector(`[data-rail-link="${linkId}"]`);
  if (!target) throw new Error(`missing rail link ${linkId}`);
  fireEvent.mouseDown(target);
}

describe('SplitNavRail', () => {
  beforeEach(() => {
    mocks.links = [link('mail', 'Email'), link('calendar', 'Calendar')];
    mocks.sideSplitIds = new Set();
    mocks.openSplits = new Map();
    mocks.canFit = true;
    mocks.close.mockClear();
    mocks.createNewSplit.mockClear().mockReturnValue({ id: 'split-new' });
    mocks.markSideSplit.mockClear();
  });

  it('docks a destination as a side split', () => {
    const { container } = render(() => <SplitNavRail />);
    clickDestination(container, 'mail');

    expect(mocks.createNewSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { type: 'component', id: 'mail', params: undefined },
        activate: true,
        referredFrom: 'sidebar',
      })
    );
    expect(mocks.markSideSplit).toHaveBeenCalledWith('split-new');
  });

  it('undocks a destination that is already docked', () => {
    mocks.openSplits.set('component:mail', 'split-mail');
    mocks.sideSplitIds.add('split-mail');

    const { container } = render(() => <SplitNavRail />);
    clickDestination(container, 'mail');

    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.createNewSplit).not.toHaveBeenCalled();
  });

  it('marks a docked destination active', () => {
    mocks.openSplits.set('component:mail', 'split-mail');
    mocks.sideSplitIds.add('split-mail');

    const { container } = render(() => <SplitNavRail />);

    const isActive = (linkId: string) =>
      container
        .querySelector(`[data-rail-link="${linkId}"]`)
        ?.hasAttribute('data-active');

    expect(isActive('mail')).toBe(true);
    expect(isActive('calendar')).toBe(false);
  });

  it('leaves a full-size split of the same view alone', () => {
    // Open, but not as a side panel — docking must not close someone's
    // full-size view, and the rail must not read as already docked.
    mocks.openSplits.set('component:mail', 'split-mail');

    const { container } = render(() => <SplitNavRail />);
    clickDestination(container, 'mail');

    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.createNewSplit).toHaveBeenCalled();
  });

  it('does nothing when the layout has no room for a side split', () => {
    mocks.canFit = false;

    const { container } = render(() => <SplitNavRail />);
    clickDestination(container, 'mail');

    expect(mocks.createNewSplit).not.toHaveBeenCalled();
    expect(mocks.markSideSplit).not.toHaveBeenCalled();
  });
});
