import { createComponent, createRoot, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshedKeys: undefined as (() => readonly unknown[]) | undefined,
  width: (): number | undefined => undefined,
}));

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({
    get width() {
      return mocks.width();
    },
    height: 800,
  }),
}));
vi.mock('../data/prDiscussionSource', () => ({
  createPrDiscussionSource: () => ({}),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: vi.fn(),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {},
  useSidePanel: () => undefined,
}));
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
  useChanges: () => ({
    layout: { changesVisible: () => false, open: () => {}, close: () => {} },
  }),
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
import { PrPageProvider } from '../context/pr-page-context';
import { createSamplePrPage } from '../data/pr-page-samples';
import { createPrPageLayout } from '../primitives/create-pr-page-layout';
import {
  createScrollHideReveal,
  scrollChromeCompensation,
} from '../primitives/create-scroll-hide-reveal';
import {
  parsePrSuggestion,
  prRowHeight,
  prSlimBarVisible,
  prStatusBand,
  prStatusTint,
} from '../primitives/pr-page-state';
import { usePrDetail } from './PrDetail';
import { PrPageTopBar } from './pr-page-top-bar';
import { PrSlimBar } from './pr-slim-bar';
import { PrChecksList, PrDetailsSection } from './shared/pr-details';
import { PrPageContent } from './shared/pr-page-content';

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

describe('PR page scroll ownership and top-bar placement', () => {
  it('puts the action group after a growing real title element at the bar right edge', () => {
    const container = document.createElement('div');
    const dispose = render(
      () =>
        createComponent(PrPageTopBar, {
          changesVisible: true,
          floatingDetails: false,
          detailsOpen: false,
          checksOpen: true,
          onDetailsOpenChange: () => {},
          onChecksOpenChange: () => {},
          onFile: () => {},
          share: () => {},
          onTask: () => {},
        }),
      container
    );
    try {
      const bar = container.querySelector('[data-view-shell-top-bar]');
      const title = bar?.firstElementChild;
      const actions = bar?.lastElementChild;
      expect(title).toBeInstanceOf(HTMLDivElement);
      expect(actions).toBeInstanceOf(HTMLDivElement);
      if (!(title instanceof HTMLElement) || !(actions instanceof HTMLElement))
        throw new Error('Top-bar layout groups are missing');
      expect(getComputedStyle(title).flexGrow).toBe('1');
      expect(getComputedStyle(title).flexBasis).toBe('0%');
      expect(getComputedStyle(actions).marginLeft).toBe('auto');
      expect(title.nextElementSibling).toBe(actions);
      expect(actions.querySelectorAll('button').length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('restores each tab on the same page scroller and ignores nested scrolls', () => {
    const container = document.createElement('div');
    const [tab, setTab] = createSignal<'overview' | 'changes'>('overview');
    const refs: HTMLDivElement[] = [];
    const nested = document.createElement('div');
    const dispose = render(
      () =>
        createComponent(PrPageContent, {
          get tab() {
            return tab();
          },
          header: document.createElement('header'),
          tabs: () => document.createElement('nav'),
          children: nested,
          scrollerRef: (element) => refs.push(element),
        }),
      container
    );
    try {
      const scroller = refs[0];
      scroller.scrollTop = 240;
      scroller.dispatchEvent(new Event('scroll'));
      setTab('changes');
      expect(scroller.scrollTop).toBe(0);
      scroller.scrollTop = 600;
      scroller.dispatchEvent(new Event('scroll'));
      nested.scrollTop = 90;
      nested.dispatchEvent(new Event('scroll', { bubbles: true }));
      setTab('overview');
      expect(scroller.scrollTop).toBe(240);
      setTab('changes');
      expect(scroller.scrollTop).toBe(600);
      expect(refs).toEqual([scroller]);
      expect(scroller.contains(nested)).toBe(true);
    } finally {
      dispose();
    }
  });
});

describe('PR status strip C', () => {
  it('appears only after title and pills leave the page viewport in either direction', () => {
    expect(prSlimBarVisible(0)).toBe(false);
    expect(prSlimBarVisible(85)).toBe(false);
    expect(prSlimBarVisible(86)).toBe(true);
    expect(prSlimBarVisible(240)).toBe(true);
    expect(prSlimBarVisible(85)).toBe(false);
    expect(prSlimBarVisible(86, 160)).toBe(false);
    expect(prSlimBarVisible(159, 160)).toBe(false);
    expect(prSlimBarVisible(160, 160)).toBe(true);
  });

  it.each([
    ['open', 'var(--color-success)', 0.12, 0.14],
    ['changes-requested', 'var(--color-failure)', 0.12, 0.14],
    ['checks-failing', 'var(--color-failure)', 0.12, 0.14],
    ['closed', 'var(--color-failure)', 0.12, 0.14],
    ['merged', 'var(--color-note)', 0.12, 0.14],
    ['draft', 'var(--color-ink-muted)', 0.08, 0.1],
  ] as const)(
    'shares the %s band tint with the strip',
    (state, color, lightOpacity, darkOpacity) => {
      expect(prStatusTint(state)).toEqual({ color, lightOpacity, darkOpacity });
    }
  );

  it('restores the wide Details preference instead of staying in the initial overlay mode', () => {
    const [width, setWidth] = createSignal(1440);
    const [changes, setChanges] = createSignal(false);
    const [overlay, setOverlay] = createSignal(true);
    const [wideOpen, setWideOpen] = createSignal(true);
    mocks.width = width;
    const root = createRoot((dispose) => ({
      dispose,
      layout: createPrPageLayout(changes, {
        isOpen: () => !overlay() && wideOpen(),
        setIsOverlayMode: setOverlay,
      }),
    }));
    try {
      expect(overlay()).toBe(false);
      expect(root.layout.dockedDetails()).toBe(true);
      setChanges(true);
      expect(overlay()).toBe(true);
      expect(root.layout.dockedDetails()).toBe(false);
      setChanges(false);
      expect(root.layout.dockedDetails()).toBe(true);
      setWideOpen(false);
      setWidth(900);
      expect(overlay()).toBe(true);
      setWidth(1440);
      expect(overlay()).toBe(false);
      expect(root.layout.dockedDetails()).toBe(false);
    } finally {
      root.dispose();
      mocks.width = () => undefined;
    }
  });
});

describe('PR band to strip switch', () => {
  it('keeps band tabs transparent and retains the same Tabs node when strip chrome takes over', () => {
    const container = document.createElement('div');
    const [scrolled, setScrolled] = createSignal(false);
    const dispose = render(() => {
      const source = createSamplePrPage();
      return createComponent(PrPageProvider, {
        value: source,
        get children() {
          return createComponent(PrSlimBar, {
            get page() {
              return source.page();
            },
            get scrolled() {
              return scrolled();
            },
            compact: false,
            changesVisible: false,
            onChecks: () => {},
          });
        },
      });
    }, container);
    try {
      const row = container.firstElementChild;
      const tabs = container.querySelector('input[type="radio"]');
      expect(tabs).not.toBeNull();
      expect(row?.classList.contains('bg-panel')).toBe(false);
      expect(row?.classList.contains('border-b')).toBe(false);
      setScrolled(true);
      expect(row?.classList.contains('bg-panel')).toBe(true);
      expect(row?.classList.contains('border-b')).toBe(true);
      expect(container.querySelector('input[type="radio"]')).toBe(tabs);
      setScrolled(false);
      expect(row?.classList.contains('bg-panel')).toBe(false);
      expect(row?.classList.contains('border-b')).toBe(false);
      expect(container.querySelector('input[type="radio"]')).toBe(tabs);
    } finally {
      dispose();
    }
  });

  it('places the full-width band decoration outside the clamped title and pills', () => {
    const container = document.createElement('div');
    const decoration = document.createElement('div');
    const title = document.createElement('h1');
    const dispose = render(
      () =>
        createComponent(PrPageContent, {
          tab: 'overview',
          decoration,
          header: title,
          tabs: () => document.createElement('nav'),
          children: null,
          scrollerRef: () => {},
        }),
      container
    );
    try {
      expect(decoration.parentElement?.contains(title)).toBe(true);
      expect(decoration.parentElement).not.toBe(title.parentElement);
      expect(decoration.parentElement?.className).not.toContain('max-w');
      expect(title.parentElement?.className).toContain('max-w-[1376px]');
    } finally {
      dispose();
    }
  });
});

describe('checks expansion row', () => {
  it('expands and collapses six checks without submitting its surrounding form', () => {
    const container = document.createElement('form');
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    container.addEventListener('submit', submit);
    document.body.append(container);
    const dispose = render(() => {
      const source = createSamplePrPage();
      const page = source.page();
      if (!page) throw new Error('Missing sample page');
      return createComponent(PrPageProvider, {
        value: source,
        get children() {
          return createComponent(PrChecksList, { page, spacious: true });
        },
      });
    }, container);
    try {
      const list = container.firstElementChild;
      const control = container.querySelector('button[aria-expanded]');
      if (!(control instanceof HTMLButtonElement))
        throw new Error('Missing expansion button');
      expect(control.type).toBe('button');
      expect(control.classList.contains('min-h-9')).toBe(true);
      expect(control.classList.contains('touch:min-h-11')).toBe(true);
      expect(control.getAttribute('aria-expanded')).toBe('false');
      expect(list?.children.length).toBe(6);
      control.click();
      expect(control.getAttribute('aria-expanded')).toBe('true');
      expect(list?.children.length).toBe(7);
      control.click();
      expect(control.getAttribute('aria-expanded')).toBe('false');
      expect(list?.children.length).toBe(6);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      dispose();
      container.remove();
    }
  });
});
