import type { CalendarEventEntity, WithSearch } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarSearch } from './CalendarSearch';

const hotkey = vi.hoisted(() => ({
  run: undefined as (() => boolean) | undefined,
}));
const searchQuery = vi.hoisted(() => ({
  isPending: true,
  isFetching: false,
  data: [] as WithSearch<CalendarEventEntity>[],
}));

// Keep the actual SearchBar and Popover: these own input, Escape, and outside-interaction behavior.
vi.mock('@app/components/view-shell', async () => ({
  ...(await import('@app/components/view-shell/SearchBar')),
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
      label?: string;
      ref?: (element: HTMLButtonElement) => void;
    }
  ) => (
    <button
      type={props.type ?? 'button'}
      ref={props.ref}
      aria-label={props.label ?? props['aria-label']}
      aria-expanded={props['aria-expanded']}
      aria-haspopup={props['aria-haspopup']}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
    >
      {props.children}
    </button>
  ),
  Surface: (props: ParentProps & { 'data-search-bar'?: string }) => (
    <div data-search-bar={props['data-search-bar']}>{props.children}</div>
  ),
  Layer: (props: ParentProps) => <div>{props.children}</div>,
  Hotkey: () => null,
  EmptyStatePanel: (props: { title: string }) => <div>{props.title}</div>,
}));
vi.mock('./CalendarSearchFilters', () => ({
  DEFAULT_CALENDAR_SEARCH_FILTERS: {
    searchOn: 'name_content',
    matchType: 'partial',
    statuses: [],
    organizers: [],
    attendees: [],
  },
  CalendarSearchFilters: () => null,
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarSearchUiFlag: () => () => true,
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({ displaySettings: { timeFormat: '12h' } }),
}));
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({ activeData: () => undefined }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'calendar-test' }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: (options: { keyDownHandler: () => boolean }) => {
    hotkey.run = options.keyDownHandler;
    return { dispose: () => (hotkey.run = undefined) };
  },
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => searchQuery,
}));
vi.mock('@queries/calendar/mention-preview', () => ({
  useCalendarMentionPreviewQuery: () => ({ isSuccess: false }),
  useCalendarSearchPreviewsQuery: () => ({ isSuccess: false }),
}));

beforeEach(() => {
  searchQuery.isPending = true;
  searchQuery.data = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const [expanded, setExpanded] = createSignal(false);
  const [popupReady, setPopupReady] = createSignal(true);
  const activatePeriod = vi.fn();
  render(() => (
    <>
      <div data-view-shell-top-bar="">
        <CalendarSearch
          inline
          compact
          expanded={expanded()}
          popupReady={popupReady()}
          onExpand={() => setExpanded(true)}
          onDismiss={() => setExpanded(false)}
        />
        <button type="button">Outside search</button>
        <div
          data-calendar-period-controls=""
          onClick={() => setExpanded(false)}
        >
          <button type="button" onClick={activatePeriod}>
            Next period
          </button>
        </div>
      </div>
      <div data-calendar-period-controls="">
        <button type="button">Other pane period</button>
      </div>
    </>
  ));
  const input = () =>
    screen.getByRole('searchbox', {
      name: 'Search events',
    }) as HTMLInputElement;
  const ghost = () => screen.getByRole('button', { name: 'Search events' });
  return { expanded, input, ghost, activatePeriod, setPopupReady };
}

describe('compact calendar search', () => {
  it('starts as a ghost button and expands on click with input focus', async () => {
    const { expanded, ghost, input } = setup();
    expect(ghost().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(ghost());
    expect(expanded()).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it('focuses immediately but hides the popup until expansion finishes', async () => {
    const { ghost, input, setPopupReady } = setup();
    setPopupReady(false);
    fireEvent.click(ghost());
    await waitFor(() => expect(document.activeElement).toBe(input()));
    const popup = await screen.findByRole('dialog', { hidden: true });
    expect(popup.getAttribute('aria-hidden')).toBe('true');
    expect((popup as HTMLElement).inert).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    setPopupReady(true);
    expect(await screen.findByRole('dialog')).toBe(popup);
    expect(popup.hasAttribute('aria-hidden')).toBe(false);
    expect((popup as HTMLElement).inert).toBe(false);
    expect(document.activeElement).toBe(input());
  });
  it('keeps the same input mounted but inaccessible while collapsed', async () => {
    const { ghost, input } = setup();
    const collapsedInput = screen.getByRole('searchbox', {
      name: 'Search events',
      hidden: true,
    });
    const layer = collapsedInput.closest('[aria-hidden]');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect((layer as HTMLElement).inert).toBe(true);
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(ghost());
    expect(input()).toBe(collapsedInput);
    expect(layer?.getAttribute('aria-hidden')).toBe('false');
    expect((layer as HTMLElement).inert).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(collapsedInput));
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('searchbox', { hidden: true })).toBe(
      collapsedInput
    );
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect((layer as HTMLElement).inert).toBe(true);

    fireEvent.click(ghost());
    expect(input()).toBe(collapsedInput);
    await waitFor(() => expect(document.activeElement).toBe(collapsedInput));
  });

  it('expands through the scoped search hotkey', async () => {
    const { expanded, input } = setup();
    expect(hotkey.run?.()).toBe(true);
    expect(expanded()).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it('collapses on Escape and keeps the query for the next expansion', async () => {
    const { expanded, ghost, input } = setup();
    fireEvent.click(ghost());
    fireEvent.input(input(), { target: { value: 'planning' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(expanded()).toBe(false));
    expect(screen.queryByRole('searchbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(ghost()));
    fireEvent.click(ghost());
    expect(input().value).toBe('planning');
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it('collapses on the close action without clearing the query', async () => {
    const { expanded, ghost, input } = setup();
    fireEvent.click(ghost());
    fireEvent.input(input(), { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    await waitFor(() => expect(document.activeElement).toBe(ghost()));
    await waitFor(() => expect(expanded()).toBe(false));
    fireEvent.click(ghost());
    expect(input().value).toBe('review');
  });

  it('restores focus to Search when Escape closes the read-only event preview', async () => {
    searchQuery.isPending = false;
    searchQuery.data = [
      {
        type: 'calendar_event',
        id: 'past-event',
        name: 'Past event',
        ownerId: 'calendar-test',
        status: 'confirmed',
        isReadOnly: true,
        time: {
          kind: 'allDay',
          startDate: '2000-01-01',
          endDate: '2000-01-02',
        },
        search: {
          nameHighlight: null,
          senderHighlightTerms: null,
          contentHitData: null,
          source: 'service',
        },
      },
    ];
    const { expanded, ghost, input } = setup();
    fireEvent.click(ghost());
    fireEvent.input(input(), { target: { value: 'past' } });
    fireEvent.click(await screen.findByRole('button', { name: /Past event/ }));
    const back = await screen.findByRole('button', { name: 'Back to search' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.keyDown(back, { key: 'Escape' });
    await waitFor(() => expect(expanded()).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(ghost()));
  });

  it('keeps a period control in place until its click completes', async () => {
    const { expanded, ghost, activatePeriod } = setup();
    fireEvent.click(ghost());
    await screen.findByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = screen.getByRole('button', { name: 'Next period' });
    fireEvent.pointerDown(next);
    expect(expanded()).toBe(true);
    expect(activatePeriod).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(activatePeriod).toHaveBeenCalledOnce();
    await waitFor(() => expect(expanded()).toBe(false));
  });
  it('dismisses when interacting with period controls in another pane', async () => {
    const { expanded, ghost } = setup();
    fireEvent.click(ghost());
    await screen.findByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Other pane period' })
    );
    await waitFor(() => expect(expanded()).toBe(false));
  });
  it('dismisses the expanded search after an outside pointer interaction', async () => {
    const { expanded, ghost, input } = setup();
    fireEvent.click(ghost());
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await screen.findByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Outside search' })
    );
    await waitFor(() => expect(expanded()).toBe(false));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
