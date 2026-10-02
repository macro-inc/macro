import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The container only wires Android's system Back on the native Android app.
vi.mock(import('@core/util/platform'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlatform: (target: Parameters<typeof actual.isPlatform>[0]) =>
      Array.isArray(target) ? target.includes('android') : target === 'android',
  };
});

// Back routing needs no panel content, and the real panel pulls in the whole app.
vi.mock('../components/SplitPanel', () => ({ SplitPanel: () => null }));

import { useSplitBackInterceptor } from '../back-interceptor';
import type { SplitId, SplitState } from '../layoutManager';
import type { MobileSwipeLayout } from '../mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from '../mobile/MobileSplitContainer';

function stubSwipeLayout(
  overrides: Partial<MobileSwipeLayout> = {}
): MobileSwipeLayout {
  return {
    slotASplitId: () => undefined,
    slotBSplitId: () => undefined,
    fgIsSlotA: () => true,
    canGoBack: () => true,
    completeSwipeBack: () => {},
    completeNavigateForward: () => {},
    setAnimatedTrigger: () => {},
    setForwardNavigationTrigger: () => {},
    swipeBack: () => {},
    ...overrides,
  };
}

function mountContainer(mobileSwipeLayout: MobileSwipeLayout) {
  return render(() => (
    <MobileSplitContainer
      splitManager={{ getSplit: () => undefined }}
      mobileSwipeLayout={mobileSwipeLayout}
      splits={() => [] as ReadonlyArray<SplitState>}
      panelRefs={new Map<SplitId, HTMLDivElement>()}
    />
  ));
}

function pressBack() {
  return window.dispatchEvent(
    new Event('android-navigate-back', { cancelable: true })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Android system Back in the mobile split container', () => {
  it('navigates back when no view claims the press', () => {
    const swipeBack = vi.fn();
    const { unmount } = mountContainer(stubSwipeLayout({ swipeBack }));

    expect(pressBack()).toBe(false);
    expect(swipeBack).toHaveBeenCalledOnce();
    unmount();
  });

  it('lets the active view claim it, so a dirty draft keeps its composer', () => {
    const swipeBack = vi.fn();
    const confirmDraft = vi.fn(() => true);
    const { unmount } = render(() => {
      useSplitBackInterceptor(confirmDraft);
      return (
        <MobileSplitContainer
          splitManager={{ getSplit: () => undefined }}
          mobileSwipeLayout={stubSwipeLayout({ swipeBack })}
          splits={() => [] as ReadonlyArray<SplitState>}
          panelRefs={new Map<SplitId, HTMLDivElement>()}
        />
      );
    });

    expect(pressBack()).toBe(false);
    expect(confirmDraft).toHaveBeenCalledOnce();
    expect(swipeBack).not.toHaveBeenCalled();
    unmount();
  });

  it('navigates back when the view declines the press', () => {
    const swipeBack = vi.fn();
    const { unmount } = render(() => {
      useSplitBackInterceptor(() => false);
      return (
        <MobileSplitContainer
          splitManager={{ getSplit: () => undefined }}
          mobileSwipeLayout={stubSwipeLayout({ swipeBack })}
          splits={() => [] as ReadonlyArray<SplitState>}
          panelRefs={new Map<SplitId, HTMLDivElement>()}
        />
      );
    });

    expect(pressBack()).toBe(false);
    expect(swipeBack).toHaveBeenCalledOnce();
    unmount();
  });

  it('leaves root Back to Android without consulting the view', () => {
    const interceptor = vi.fn(() => true);
    const { unmount } = render(() => {
      useSplitBackInterceptor(interceptor);
      return (
        <MobileSplitContainer
          splitManager={{ getSplit: () => undefined }}
          mobileSwipeLayout={stubSwipeLayout({ canGoBack: () => false })}
          splits={() => [] as ReadonlyArray<SplitState>}
          panelRefs={new Map<SplitId, HTMLDivElement>()}
        />
      );
    });

    expect(pressBack()).toBe(true);
    expect(interceptor).not.toHaveBeenCalled();
    unmount();
  });
});
