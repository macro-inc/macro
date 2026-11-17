import {
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import {
  useSavedView,
  useSavedViews,
} from '@app/features/saved-views/queries/saved-views';
import { ViewTour } from '@app/features/tours/ViewTour';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { SplitRouter } from '@app/lib/split-router';
import { TraceFlow } from '@app/observability/flow';
import {
  PillButton,
  type PillTabItem,
  PillTabs,
} from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  enableEmailSavedViews,
  enableEmailWideSearch,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { triggerFocusInput } from '@core/directive/focusInput';
import { useAndroidBackNavigation } from '@core/mobile/androidBack';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { EmailFilterDrawer } from './components/EmailFilterDrawer';
import { EmailHeader, EmailViewBreadcrumbItem } from './components/EmailHeader';
import { EmailList } from './components/EmailList';
import { EmailReader } from './components/EmailReader';
import { EmailRecentSearches } from './components/EmailRecentSearches';
import { EmailSidebar } from './components/EmailSidebar';
import { canSearchEmailTab, EMAIL_TABS } from './constants';
import { focusEmailSearchResults } from './email-search-focus';
import { EmailViewProvider, useEmailView } from './email-view-context';
import { EMAIL_SAVED_VIEW_KIND } from './filters/email-saved-view';
import { createEmailMobileSearch } from './primitives/create-email-mobile-search';
import type { EmailListPane } from './reader-pane';
import { createEmailSearchSuggestions } from './search/create-email-search-suggestions';
import { emailTour } from './tour';
import type { EmailTab, EmailViewStateOptions } from './types';
import { useEmailSearchHotkeys } from './use-email-search-hotkeys';
import { useEmailViewHotkeys } from './use-email-view-hotkeys';
import { useReadingPaneHotkey } from './use-reading-pane-hotkey';
import {
  READING_PANE_LIST_WIDTH,
  useReadingPaneListWidth,
} from './use-reading-pane-list-width';
import { useVisibleEmailTab } from './use-visible-email-tab';
import {
  EmailSavedViewsPicker,
  EmailSavedViewUnavailable,
  EmailSavedViewWarning,
} from './views/email-saved-views';
import { EmailMobileSearch } from './views/mobile/email-search';

export type EmailViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: EmailViewStateOptions;
};

function EmailViewBreadcrumbs(props: ParentProps) {
  const { closeThread, selectedThread } = useEmailView();
  const value = () => {
    const thread = selectedThread();
    return thread ? `email-thread:${thread.id}` : 'email-view';
  };

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'email-view') closeThread();
      }}
    >
      <EmailViewBreadcrumbItem />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}

function EmailListFallback() {
  return (
    <div class="grid size-full min-h-0 min-w-0 place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <SpinnerIcon
        aria-hidden={false}
        aria-label="Loading email"
        class="size-5 animate-spin"
      />
    </div>
  );
}

function EmailPanes(props: {
  list: JSX.Element;
  focusList: () => void;
  focusSearchResults: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
  onListWidthChange: (width: number) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const shell = useViewShell();
  const { state, setState, list, source } = useEmailView();
  const userId = useUserId();
  const wideSearchFlag = useFeatureFlag(enableEmailWideSearch);
  const recentSearches = createEmailSearchSuggestions({
    userId,
    search: () => state.search,
    setSearch: (query) => setState('search', query),
  });
  const pickedResultsArrived = () =>
    recentSearches.awaitsPickedResults() &&
    !source.isLoading() &&
    !source.isFetching() &&
    !(source.showsPreviousRows?.() ?? false);
  // The list is driven imperatively, so the arrival is an effect.
  createEffect(
    on(pickedResultsArrived, (arrived) => {
      if (!arrived) return;

      recentSearches.pickedResultsTaken();
      list.navigate.toFirst();
    })
  );
  // A loading flag is not on: the compact field stays until it answers.
  const searchSuggestions = () =>
    wideSearchFlag().enabled ? recentSearches : undefined;

  const search = useEmailSearchHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    canSearch: () => canSearchEmailTab(state.tab),
  });

  const listColumn = (beside?: 'reader') => (
    <>
      <EmailHeader
        tabOnly={beside === 'reader'}
        focusSearchResults={props.focusSearchResults}
        registerSearch={search.registerListSearch}
        searchSuggestions={searchSuggestions()}
      />
      <ViewTour tour={emailTour} />
      <Show when={searchSuggestions()}>
        {(suggestions) => (
          <EmailRecentSearches
            suggestions={suggestions()}
            onPick={(index) => {
              suggestions().pick(index);
              props.focusSearchResults();
            }}
          />
        )}
      </Show>
      <ViewShell.Content>{props.list}</ViewShell.Content>
    </>
  );

  // Without room for both, the reading pane folds away and a thread
  // replaces the list, as it does with the pane turned off.
  return (
    <Show
      when={shell.detail.placement() === 'inline'}
      fallback={
        <ViewShell.Main>
          <SplitRouter.Outlet fallback={() => listColumn()} />
        </ViewShell.Main>
      }
    >
      <ViewShell.Main onWidthChangeEnd={props.onListWidthChange}>
        {listColumn('reader')}
      </ViewShell.Main>
      <ViewShell.Detail class="border-l border-edge-muted">
        <EmailReader
          focusList={props.focusList}
          setListPane={props.setListPane}
        />
      </ViewShell.Detail>
    </Show>
  );
}

function EmailDesktopLayout(props: {
  list: JSX.Element;
  focusList: () => void;
  focusSearchResults: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const { readingPane, composing } = useEmailView();
  // A new email takes the list's place, so the reading pane folds away.
  const readerBeside = () => readingPane() && !composing();
  const [listWidth, setListWidth] = useReadingPaneListWidth();

  return (
    <ViewShell.Root
      asidePreferenceKey="email"
      resizable
      aside={{ preserveDuringResize: false }}
      main={
        readerBeside()
          ? {
              preferredWidth: 640,
              width: listWidth(),
              min: READING_PANE_LIST_WIDTH.min,
              max: READING_PANE_LIST_WIDTH.max,
            }
          : { preferredWidth: 640 }
      }
      detail={{
        width: 640,
        initialWidth: 'auto',
        min: 440,
        max: 4000,
        whenNarrow: 'hide',
      }}
      detailOpen={readerBeside()}
    >
      <ViewShell.Aside>
        <EmailSidebar />
      </ViewShell.Aside>
      <EmailPanes
        list={props.list}
        focusList={props.focusList}
        focusSearchResults={props.focusSearchResults}
        setListPane={props.setListPane}
        onListWidthChange={setListWidth}
      />
    </ViewShell.Root>
  );
}

// Focus leads, as it does in the desktop Inbox tabs.
const MOBILE_EMAIL_TABS: PillTabItem<EmailTab>[] = [
  ...EMAIL_TABS.filter((tab) => tab.id === 'focus'),
  ...EMAIL_TABS.filter((tab) => tab.id !== 'focus'),
].map((tab) => ({
  value: tab.id,
  get label() {
    return tab.label;
  },
}));

function EmailMobileLayout(props: ParentProps) {
  const isVisible = useVisibleEmailTab();
  const { state, setState, setTab, savedViewActive } = useEmailView();
  const userId = useUserId();
  const wideSearchFlag = useFeatureFlag(enableEmailWideSearch);
  const suggestions = createEmailSearchSuggestions({
    userId,
    search: () => state.search,
    setSearch: (query) => setState('search', query),
  });
  let searchInput: HTMLInputElement | undefined;
  const mobileSearch = createEmailMobileSearch({
    available: () => wideSearchFlag().enabled && canSearchEmailTab(state.tab),
    search: () => state.search,
    setSearch: (search) => setState('search', search),
  });
  const searching = mobileSearch.searching;

  const openSearch = () => {
    mobileSearch.open();
    // iOS raises the keyboard only for a focus inside the tap, and the field
    // mounts after it.
    triggerFocusInput(() => searchInput);
  };
  const closeSearch = mobileSearch.close;
  useAndroidBackNavigation(() => {
    if (!searching()) return false;

    closeSearch();
    return true;
  });

  // Recent searches sit below the header, so the list then does not reserve
  // the header's height again.
  const listsRecent = () => searching() && suggestions.listed().length > 0;

  return (
    <>
      <Show when={!searching()}>
        <SplitHeaderLeft>
          <div class="flex h-full w-full min-w-0 flex-1 items-center">
            <PillTabs
              scrollable
              class="-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none"
              contentClass="px-(--mobile-chrome-gutter)"
              leading={
                <>
                  <Show
                    when={
                      wideSearchFlag().enabled && canSearchEmailTab(state.tab)
                    }
                  >
                    <PillButton
                      active={false}
                      iconOnly
                      aria-label={t('emailViews.searchEmail')}
                      onClick={openSearch}
                    >
                      <SearchIcon class="size-5" />
                    </PillButton>
                  </Show>
                  <EmailFilterDrawer />
                  <EmailSavedViewsPicker />
                </>
              }
              items={MOBILE_EMAIL_TABS.filter((tab) => isVisible(tab.value))}
              value={savedViewActive() ? undefined : state.tab}
              onChange={setTab}
            />
          </div>
        </SplitHeaderLeft>
      </Show>
      <main
        class="flex size-full min-h-0 min-w-0 flex-col"
        style={{
          // Match Inbox: 0.5rem above the 2.5rem pills, then a 0.75rem gap.
          '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 3.75rem)',
        }}
      >
        <Show when={searching()}>
          <EmailMobileSearch
            ref={(input) => {
              searchInput = input;
            }}
            search={state.search}
            setSearch={(search) => setState('search', search)}
            suggestions={suggestions}
            onCancel={closeSearch}
          />
        </Show>
        <div
          class="min-h-0 flex-1"
          style={
            listsRecent() ? { '--mobile-content-inset-top': '0px' } : undefined
          }
        >
          {props.children}
        </div>
      </main>
    </>
  );
}

function EmailViewRoot() {
  const panel = useSplitPanelOrThrow();
  const {
    state,
    setTab,
    selectedThread,
    composing,
    list: listController,
    readingPane,
    setReadingPane,
    savedViews,
    savedViewScope,
  } = useEmailView();
  const savedViewKey = () => savedViewScope()?.id;
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const [listPane, setListPane] = createSignal<EmailListPane>();
  const focusList = () => listElement()?.focus();
  const focusSearchResults = () =>
    focusEmailSearchResults(panel, listElement());

  onMount(() => panel.handle.setDisplayName('Email'));

  useReadingPaneHotkey({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    readingPane,
    setReadingPane,
  });

  useEmailViewHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    tab: () => state.tab,
    setTab,
    // Beside the reading pane the list stays on screen with a thread open;
    // without it a thread replaces the list, as a new email always does.
    listHasKeyboard: () => {
      const pane = listPane();
      if (pane) return !pane.readerHasKeyboard();
      return selectedThread() === undefined && !composing();
    },
    hasSelection: () => listController.selection.count() > 0,
    hasSearch: () =>
      canSearchEmailTab(state.tab) && state.search.trim().length > 0,
  });

  const savedViewKind = () => savedViews?.view().kind;
  const list = () => (
    <Switch>
      <Match when={savedViewKind() === 'unavailable'}>
        <EmailSavedViewUnavailable />
      </Match>
      <Match when={savedViewKind() === 'loading'}>
        <EmailListFallback />
      </Match>
      <Match when={true}>
        <div class="flex size-full min-h-0 min-w-0 flex-col">
          <EmailSavedViewWarning />
          <div class="min-h-0 flex-1">
            <Suspense fallback={<EmailListFallback />}>
              <TraceFlow
                name="email.list"
                key={() => `${state.tab}:${savedViewKey() ?? ''}`}
              >
                <EmailList ref={setListElement} pane={listPane()} />
              </TraceFlow>
            </Suspense>
          </div>
        </div>
      </Match>
    </Switch>
  );

  return (
    <StaticMarkdownContext>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <Show
            when={isTouchDevice()}
            fallback={
              <EmailDesktopLayout
                list={list()}
                focusList={focusList}
                focusSearchResults={focusSearchResults}
                setListPane={setListPane}
              />
            }
          >
            <EmailMobileLayout>{list()}</EmailMobileLayout>
          </Show>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </StaticMarkdownContext>
  );
}

/** Email shares one list across desktop sidebar and mobile pill layouts. */
export function EmailView(props: EmailViewProps) {
  const savedViewsFlag = useFeatureFlag(enableEmailSavedViews);
  const userId = useUserId();
  // A loading flag is not off; it only keeps saved views hidden meanwhile.
  const savedViewsEnabled = () => savedViewsFlag().enabled;
  const viewerId = () => (savedViewsEnabled() ? userId() : undefined);
  return (
    <ListEntityMetadataQueryProvider>
      <EmailViewProvider
        initialState={props.initialState}
        savedViewsEnabled={savedViewsEnabled}
        savedViewsSource={() =>
          useSavedViews({ viewerId, kind: EMAIL_SAVED_VIEW_KIND })
        }
        savedViewSource={(id) => useSavedView({ viewerId, id })}
      >
        <EmailViewBreadcrumbs>
          <EmailViewRoot />
        </EmailViewBreadcrumbs>
      </EmailViewProvider>
    </ListEntityMetadataQueryProvider>
  );
}
