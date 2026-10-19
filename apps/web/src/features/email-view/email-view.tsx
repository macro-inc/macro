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
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableReminders } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createSignal,
  type JSX,
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
import { EmailReader } from './components/EmailReader';
import { EmailSidebar } from './components/EmailSidebar';
import { EMAIL_TABS } from './constants';
import { EmailViewProvider, useEmailView } from './email-view-context';
import type { EmailListPane } from './reader-pane';
import { emailTour } from './tour';
import type { EmailTab, EmailViewStateOptions } from './types';
import { useReadingPaneHotkey } from './use-reading-pane-hotkey';

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

/** The list column's width beside the reading pane, in pixels. */
const LIST_WIDTH = { default: 440, min: 340, max: 720 };

function EmailDesktopLayout(props: {
  list: JSX.Element;
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const { readingPane } = useEmailView();
  const [storedListWidth, setListWidth] = usePreference(
    'macro:pref:email:reading-pane-list-width',
    { default: LIST_WIDTH.default }
  );
  // A stored width from an older layout still fits the current bounds.
  const listWidth = () =>
    Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, storedListWidth()));

  return (
    <ViewShell.Root
      asidePreferenceKey="email"
      resizable
      aside={{ preserveDuringResize: false }}
      main={
        readingPane()
          ? {
              preferredWidth: 640,
              width: listWidth(),
              min: LIST_WIDTH.min,
              max: LIST_WIDTH.max,
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
  const { readingPane, setReadingPane } = useEmailView();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const [listPane, setListPane] = createSignal<EmailListPane>();
  const focusList = () => listElement()?.focus();

  onMount(() => panel.handle.setDisplayName('Email'));

  useReadingPaneHotkey({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
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
