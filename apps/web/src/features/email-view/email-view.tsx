import {
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { ViewTour } from '@app/features/tours/ViewTour';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SplitRouter } from '@app/lib/split-router';
import { usePreference } from '@app/preferences/use-preference';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableReminders } from '@core/constant/featureFlags';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import EnvelopeOpenIcon from '@phosphor/envelope-simple-open.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { EmailFilterDrawer } from './components/EmailFilterDrawer';
import {
  EmailHeader,
  EmailTopBar,
  EmailViewBreadcrumbItem,
} from './components/EmailHeader';
import { EmailList } from './components/EmailList';
import { EmailSidebar } from './components/EmailSidebar';
import { composeEmail } from './compose-email';
import { EMAIL_TABS } from './constants';
import { EmailViewProvider, useEmailView } from './email-view-context';
import { type EmailListPane, EmailReaderPaneContext } from './reader-pane';
import { emailTour } from './tour';
import type { EmailTab, EmailViewStateOptions } from './types';
import { useEmailViewHotkeys } from './use-email-view-hotkeys';

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
      <SpinnerIcon aria-label="Loading email" class="size-5 animate-spin" />
    </div>
  );
}

function EmailReaderEmpty() {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col items-center justify-center gap-1 px-6 text-center">
      <EnvelopeOpenIcon class="mb-2 size-6 text-ink-extra-muted" />
      <p class="text-sm text-ink-muted">No conversation selected</p>
      <p class="text-xs text-ink-extra-muted">
        Pick one from the list, or move with j and k
      </p>
    </div>
  );
}

/** The reading pane: the thread route, in its own hotkey scope. */
function EmailReader(props: {
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('email-reader');
  const [focusRequest, setFocusRequest] = createSignal<string>();
  props.setListPane({ focusReader: setFocusRequest });
  onCleanup(() => props.setListPane(undefined));
  return (
    <div ref={attachHotkeys} class="size-full min-h-0 min-w-0">
      <EmailReaderPaneContext.Provider
        value={{
          hotkeyScope,
          focusList: props.focusList,
          focusRequest,
          requestFocus: setFocusRequest,
          clearFocusRequest: () => setFocusRequest(undefined),
        }}
      >
        <SplitRouter.Outlet fallback={EmailReaderEmpty} />
      </EmailReaderPaneContext.Provider>
    </div>
  );
}

function EmailPanes(props: {
  list: JSX.Element;
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
  onListWidthChange: (width: number) => void;
}) {
  const shell = useViewShell();
  const listColumn = (beside?: 'reader') => (
    <>
      <EmailTopBar tabOnly={beside === 'reader'} />
      <ViewShell.Header>
        <EmailHeader onSearchEscape={props.focusList} />
      </ViewShell.Header>
      <ViewTour tour={emailTour} />
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
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const { readingPane } = useEmailView();
  const [listWidth, setListWidth] = usePreference(
    'macro:pref:email:reading-pane-list-width',
    { default: 440 }
  );

  return (
    <ViewShell.Root
      asidePreferenceKey="email"
      resizable
      aside={{ preserveDuringResize: false }}
      main={
        readingPane()
          ? { preferredWidth: 640, width: listWidth(), min: 340, max: 720 }
          : { preferredWidth: 640 }
      }
      detail={{
        width: 640,
        initialWidth: 'auto',
        min: 440,
        max: 4000,
        whenNarrow: 'hide',
      }}
      detailOpen={readingPane()}
    >
      <ViewShell.Aside>
        <EmailSidebar />
      </ViewShell.Aside>
      <EmailPanes
        list={props.list}
        focusList={props.focusList}
        setListPane={props.setListPane}
        onListWidthChange={setListWidth}
      />
    </ViewShell.Root>
  );
}

const MOBILE_EMAIL_TABS: PillTabItem<EmailTab>[] = EMAIL_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
}));

function EmailMobileLayout(props: ParentProps) {
  const reminders = useFeatureFlag(enableReminders);
  const { state, setTab } = useEmailView();

  return (
    <>
      <SplitHeaderLeft>
        <div class="flex h-full w-full min-w-0 flex-1 items-center">
          <PillTabs
            scrollable
            class="-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none"
            contentClass="px-(--mobile-chrome-gutter)"
            leading={<EmailFilterDrawer />}
            items={MOBILE_EMAIL_TABS.filter(
              (tab) =>
                tab.value !== 'reminders' ||
                reminders().enabled ||
                (reminders().loading && state.tab === 'reminders')
            )}
            value={state.tab}
            onChange={setTab}
          />
        </div>
      </SplitHeaderLeft>
      <main
        class="size-full min-h-0 min-w-0"
        style={{
          // Match Inbox: 0.5rem above the 2.5rem pills, then a 0.75rem gap.
          '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 3.75rem)',
        }}
      >
        {props.children}
      </main>
    </>
  );
}

function EmailViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const {
    state,
    setTab,
    selectedThread,
    list: listController,
    readingPane,
    setReadingPane,
  } = useEmailView();
  const reminders = useFeatureFlag(enableReminders);
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const [listPane, setListPane] = createSignal<EmailListPane>();
  const focusList = () => listElement()?.focus();

  onMount(() => panel.handle.setDisplayName('Email'));

  useEmailViewHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    tab: () => state.tab,
    setTab,
    isTabAvailable: (tab) => tab !== 'reminders' || reminders().enabled,
    threadOpen: () => selectedThread() !== undefined,
    hasSelection: () => listController.selection.count() > 0,
    compose: () => composeEmail(openWithSplit, state.inboxIds),
    readingPane,
    setReadingPane,
  });

  const list = () => (
    <Suspense fallback={<EmailListFallback />}>
      <EmailList ref={setListElement} pane={listPane()} />
    </Suspense>
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
  return (
    <ListEntityMetadataQueryProvider>
      <EmailViewProvider initialState={props.initialState}>
        <EmailViewBreadcrumbs>
          <EmailViewRoot />
        </EmailViewBreadcrumbs>
      </EmailViewProvider>
    </ListEntityMetadataQueryProvider>
  );
}
