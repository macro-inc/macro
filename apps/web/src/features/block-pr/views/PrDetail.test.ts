import { createComponent, createRoot, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshedKeys: undefined as (() => readonly unknown[]) | undefined,
}));

vi.mock('../data/prDiscussionSource', () => ({
  createPrDiscussionSource: () => ({}),
}));
vi.mock('@app/components/view-shell', () => ({ ViewShell: {} }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: vi.fn(),
}));
vi.mock('@components/app/side-panel', () => ({ SidePanel: {} }));
vi.mock('@components/app/split-panel', () => ({ SplitPanel: {} }));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => null,
    StaticMarkdownContext: {},
  })
);
vi.mock('@entity/components/GithubLabelPill', () => ({
  GithubLabelPills: () => null,
}));
vi.mock('@notifications', () => ({
  NotificationReadMarker: () => null,
}));
vi.mock('@queries/storage/github-pull-requests', () => ({
  useRefreshGithubPullRequest: (
    _reference: unknown,
    refreshedKeys: () => readonly unknown[]
  ) => {
    mocks.refreshedKeys = refreshedKeys;
  },
}));
vi.mock('../data/queries', () => ({
  usePrForeignEntityQuery: () => ({ isPending: true }),
  prForeignEntityQueryKey: (id: string) => ['pr-foreign-entity', id],
}));
vi.mock('@app/features/changes/changes', () => ({
  ChangesSplit: () => null,
  ChangesToggle: () => null,
}));
vi.mock('../component/PrChanges', () => ({ PrChangesProvider: () => null }));
vi.mock('../component/PrTimeline', () => ({ PrTimeline: () => null }));
vi.mock('../component/sidepanel/PrSidePanelSections', () => ({
  PrSidePanelSections: () => null,
}));
// Keeps ForwardToChannel (and its websocket) out of this refresh-wiring unit.
vi.mock('../hooks/usePrShare', () => ({
  usePrShare: () => ({
    openShare: () => undefined,
    ShareModal: () => null,
    isOpen: () => false,
  }),
}));

import { githubPullRequestChangesKeys } from '@queries/storage/keys';
import {
  createScrollHideReveal,
  scrollChromeCompensation,
} from '../primitives/create-scroll-hide-reveal';
import {
  parsePrSuggestion,
  prRowHeight,
  prStatusBand,
} from '../primitives/pr-page-state';
import { usePrDetail } from './PrDetail';
import { PrDetailsSection } from './shared/pr-details';

describe('PR refresh wiring', () => {
  it('passes the PR details and changes summary keys to the refresh', () => {
    const id = '019a5faa-d2cd-7c55-8e8a-23aac4f0bc88';
    createRoot((dispose) => {
      usePrDetail(() => id);
      expect(mocks.refreshedKeys?.()).toEqual([
        ['pr-foreign-entity', id],
        githubPullRequestChangesKeys.summary(id).queryKey,
      ]);
      dispose();
    });
  });
});

describe('PR page presentation state', () => {
  it('keeps lifecycle tint ahead of check and review tint', () => {
    expect(
      prStatusBand({
        status: 'merged',
        checks: [
          { id: 1, name: 'check', status: 'completed', conclusion: 'failure' },
        ],
      })
    ).toBe('merged');
    expect(
      prStatusBand({
        status: 'open',
        reviewers: [{ githubUserId: '1', state: 'changes_requested' }],
      })
    ).toBe('changes-requested');
  });

  it('extracts a suggestion without dropping surrounding prose', () => {
    expect(
      parsePrSuggestion('Before\n```suggestion\nnew code\n```\nAfter')
    ).toEqual({ before: 'Before', suggestion: 'new code', after: 'After' });
    expect(prRowHeight('compact')).toBe(30);
    expect(prRowHeight('touch')).toBe(44);
  });
});

describe('PR scroll chrome', () => {
  it('reserves the measured removed chrome for short content and follows top-bar restoration', () => {
    expect(scrollChromeCompensation(180, 48, 44, 44, false)).toBe(0);
    expect(scrollChromeCompensation(180, 48, 44, 44, true)).toBe(132);
    expect(scrollChromeCompensation(180, 48, 44, 0, true)).toBe(176);
    expect(scrollChromeCompensation(180, 48, 44, 22, true)).toBe(154);
    expect(scrollChromeCompensation(180, 48, 44, 44, false)).toBe(0);
    expect(scrollChromeCompensation(180, 0, 0, 0, true)).toBe(180);
  });

  it('ignores programmatic clamping and keeps separate position baselines', () => {
    createRoot((dispose) => {
      const scroll = createScrollHideReveal(() => 'overview');
      scroll.onScroll('overview', 160);
      expect(scroll.scrolled()).toBe(false);
      scroll.intent('overview').markUserIntent('down');
      scroll.onScroll('overview', 168);
      expect(scroll.scrolled()).toBe(true);
      expect(scroll.topBarVisible()).toBe(false);
      // A short document clamps when chrome leaves; this is not a new gesture.
      scroll.onScroll('overview', 130);
      expect(scroll.scrolled()).toBe(true);
      expect(scroll.topBarVisible()).toBe(false);
      scroll.onScroll('changes', 900);
      scroll.intent('overview').markUserIntent('up');
      scroll.onScroll('overview', 122);
      expect(scroll.scrolled()).toBe(false);
      expect(scroll.topBarVisible()).toBe(true);
      dispose();
    });
  });

  it('restores each pane at its own scroll state without animating the pane switch', () => {
    createRoot((dispose) => {
      const [pane, setPane] = createSignal<'overview' | 'changes'>('overview');
      const scroll = createScrollHideReveal(pane);
      scroll.intent('overview').markUserIntent('down');
      scroll.onScroll('overview', 160);
      expect(scroll.scrolled()).toBe(true);
      expect(scroll.animate()).toBe(true);
      setPane('changes');
      expect(scroll.scrolled()).toBe(false);
      expect(scroll.topBarVisible()).toBe(true);
      expect(scroll.animate()).toBe(false);
      scroll.intent('changes').markUserIntent('down');
      scroll.onScroll('changes', 200);
      expect(scroll.scrolled()).toBe(true);
      expect(scroll.animate()).toBe(true);
      setPane('overview');
      expect(scroll.scrolled()).toBe(true);
      expect(scroll.animate()).toBe(false);
      dispose();
    });
  });

  it('restores the full header on upward intent when a short pane is already at zero', () => {
    createRoot((dispose) => {
      const scroll = createScrollHideReveal(() => 'changes');
      scroll.intent('changes').markUserIntent('down');
      scroll.onScroll('changes', 160);
      scroll.onScroll('changes', 0);
      expect(scroll.scrolled()).toBe(true);
      scroll.intent('changes').markUserIntent('up');
      expect(scroll.scrolled()).toBe(false);
      expect(scroll.topBarVisible()).toBe(true);
      dispose();
    });
  });

  it('uses scrollbar movement rather than the preceding wheel direction', () => {
    createRoot((dispose) => {
      const scroll = createScrollHideReveal(() => 'changes');
      scroll.onScroll('changes', 160);
      scroll.intent('changes').markUserIntent('down');
      scroll.onScroll('changes', 168);
      expect(scroll.topBarVisible()).toBe(false);
      scroll.intent('changes').markUserIntent('down');
      scroll.onScroll('changes', 160);
      expect(scroll.topBarVisible()).toBe(true);
      dispose();
    });
  });
});

describe('PR detail section refs', () => {
  it('accepts an omitted getter-only ref and forwards a supplied callback', () => {
    const container = document.createElement('div');
    const omitted = {
      title: 'Section',
      children: null,
      get sectionRef() {
        return undefined;
      },
    };
    const disposeOmitted = render(
      () => createComponent(PrDetailsSection, omitted),
      container
    );
    disposeOmitted();
    const forwarded = vi.fn();
    const supplied = {
      title: 'Section',
      children: null,
      get sectionRef() {
        return forwarded;
      },
    };
    const disposeSupplied = render(
      () => createComponent(PrDetailsSection, supplied),
      container
    );
    try {
      expect(forwarded).toHaveBeenCalledExactlyOnceWith(
        container.querySelector('section')
      );
    } finally {
      disposeSupplied();
    }
  });
});
