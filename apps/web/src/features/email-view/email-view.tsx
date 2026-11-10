import {
  CollectionPanes,
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import {
  DEFAULT_ASIDE_LAYOUT,
  WIDE_TOUCH_ASIDE_SCALE,
} from '@app/components/view-shell/view-shell-layout';
import { ViewTour } from '@app/features/tours/ViewTour';
import { SplitRouter } from '@app/lib/split-router';
import { TraceFlow } from '@app/observability/flow';
import { usePreference } from '@app/preferences/use-preference';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import {
  createSignal,
  type JSX,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { EmailFilterDrawer } from './components/EmailFilterDrawer';
import { EmailHeader, EmailViewBreadcrumbItem } from './components/EmailHeader';
import { EmailList } from './components/EmailList';
import { EmailReader, EmailReaderEmpty } from './components/EmailReader';
import { EmailSidebar } from './components/EmailSidebar';
import {
  EMAIL_INBOX_TAB_IDS,
  EMAIL_TAB_LABELS,
  isEmailInboxTab,
} from './constants';
import { EmailViewProvider, useEmailView } from './email-view-context';
import type { EmailListPane } from './reader-pane';
import { emailTour } from './tour';
import type { EmailViewStateOptions } from './types';
import { useEmailViewHotkeys } from './use-email-view-hotkeys';
import { useReadingPaneHotkey } from './use-reading-pane-hotkey';
import { useVisibleEmailTab } from './use-visible-email-tab';

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

function DesktopEmailPanes(props: {
  list: JSX.Element;
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
  onListWidthChange: (width: number) => void;
}) {
  const shell = useViewShell();
  const listColumn = (beside?: 'reader') => (
    <>
      <ViewTour tour={emailTour} />
      <EmailHeader
        tabOnly={beside === 'reader'}
        onSearchEscape={props.focusList}
      />
      <ViewShell.Content>{props.list}</ViewShell.Content>
    </>
  );

  // Without room for both, the reading pane folds away and a thread
  // replaces the list, as it does with the pane turned off.
  return (
    <Show
      when={shell.detail.placement() === 'inline'}
      fallback={
        <ViewShell.Main class="relative">
          <SplitRouter.Outlet fallback={() => listColumn()} />
        </ViewShell.Main>
      }
    >
      <ViewShell.Main
        class="relative"
        onWidthChangeEnd={props.onListWidthChange}
      >
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

function TouchEmailPanes(props: {
  list: JSX.Element;
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
  onListWidthChange: (width: number) => void;
}) {
  const shell = useViewShell();
  const { selectedThread, composing, closeThread, navigateToList } =
    useEmailView();
  return (
    <CollectionPanes
      list={
        <>
          <ViewTour tour={emailTour} />
          <EmailMobileLayout>{props.list}</EmailMobileLayout>
        </>
      }
      hasDetail={!!selectedThread() || composing()}
      empty={<EmailReaderEmpty />}
      onListWidthChangeEnd={props.onListWidthChange}
      onBack={selectedThread() ? navigateToList : undefined}
    >
      <EmailReader
        focusList={() => {
          if (shell.breakpoints.narrow?.()) closeThread();
          else props.focusList();
        }}
        setListPane={props.setListPane}
      />
    </CollectionPanes>
  );
}

/** The list column's width beside the reading pane, in pixels. */
const LIST_WIDTH = { default: 440, min: 340, max: 720 };

function EmailLayout(props: {
  list: JSX.Element;
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const { readingPane, composing } = useEmailView();
  // A new email takes the list's place, so the reading pane folds away.
  const readerBeside = () => readingPane() && !composing();
  const [storedListWidth, setListWidth] = usePreference(
    'macro:pref:email:reading-pane-list-width',
    { default: LIST_WIDTH.default }
  );
  // Keep the shared reading-pane preference in desktop units, as sidebar
  // widths are, so device changes do not compound the touch sizing.
  const listScale = () =>
    isTouchDevice()
      ? (DEFAULT_ASIDE_LAYOUT.width * WIDE_TOUCH_ASIDE_SCALE) /
        LIST_WIDTH.default
      : 1;
  const listWidth = () =>
    Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, storedListWidth())) *
    listScale();
  const updateListWidth = (width: number) => setListWidth(width / listScale());

  return (
    <ViewShell.Root
      contentLayout="collection"
      asidePreferenceKey="email"
      resizable
      aside={{ preserveDuringResize: false }}
      main={{
        preferredWidth: 640,
        width: listWidth(),
        min: isTouchDevice() || !readerBeside() ? 320 : LIST_WIDTH.min,
        max: LIST_WIDTH.max * listScale(),
      }}
      detail={
        isTouchDevice()
          ? undefined
          : {
              width: 640,
              initialWidth: 'auto',
              min: 440,
              max: 4000,
              whenNarrow: 'hide',
            }
      }
      detailOpen={!isTouchDevice() && readerBeside()}
    >
      <ViewShell.Aside>
        <EmailSidebar />
      </ViewShell.Aside>
      <Show
        when={isTouchDevice()}
        fallback={
          <DesktopEmailPanes
            list={props.list}
            focusList={props.focusList}
            setListPane={props.setListPane}
            onListWidthChange={updateListWidth}
          />
        }
      >
        <TouchEmailPanes
          list={props.list}
          focusList={props.focusList}
          setListPane={props.setListPane}
          onListWidthChange={updateListWidth}
        />
      </Show>
    </ViewShell.Root>
  );
}

function EmailMobileLayout(props: ParentProps) {
  const isVisible = useVisibleEmailTab();
  const { state, setTab, tagViewTitle } = useEmailView();
  const inboxSelected = () => isEmailInboxTab(state.tab);
  const tabs = () =>
    inboxSelected()
      ? EMAIL_INBOX_TAB_IDS.filter(isVisible).map((id) => ({
          value: id,
          label: EMAIL_TAB_LABELS[id],
        }))
      : [];

  return (
    <MobileListLayout
      header={
        <PillTabs
          scrollable
          class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
          contentClass="px-(--mobile-chrome-gutter)"
          leading={
            <>
              <ViewSidebar.Toggle action="expand" presentation="pill" />
              <EmailFilterDrawer />
            </>
          }
          items={tabs()}
          trailing={
            <Show when={!inboxSelected()}>
              <HeaderIsland>
                <span class="truncate text-sm font-medium">
                  {tagViewTitle() ?? EMAIL_TAB_LABELS[state.tab]}
                </span>
              </HeaderIsland>
            </Show>
          }
          value={state.tab}
          onChange={setTab}
        />
      }
    >
      {props.children}
    </MobileListLayout>
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
  } = useEmailView();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const [listPane, setListPane] = createSignal<EmailListPane>();
  const focusList = () => listElement()?.focus();

  onMount(() => {
    panel.handle.setDisplayName('Email');
    panel.handle.updateMeta?.({ splitPanelLayout: 'composable' });
  });

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
  });

  const list = () => (
    <Suspense fallback={<EmailListFallback />}>
      <TraceFlow name="email.list" key={() => state.tab}>
        <EmailList ref={setListElement} pane={listPane()} />
      </TraceFlow>
    </Suspense>
  );

  return (
    <StaticMarkdownContext>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <EmailLayout
            list={list()}
            focusList={focusList}
            setListPane={setListPane}
          />
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
