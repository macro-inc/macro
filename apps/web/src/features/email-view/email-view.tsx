import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SplitRouter } from '@app/lib/split-router';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createSignal,
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
import { ScheduledEmailList } from './components/ScheduledEmailList';
import { EMAIL_TABS } from './constants';
import { EmailViewProvider, useEmailView } from './email-view-context';
import type { EmailTab, EmailViewStateOptions } from './types';

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

function EmailDesktopLayout(
  props: ParentProps<{ onSearchEscape: () => void }>
) {
  const list = () => (
    <>
      <EmailTopBar />
      <ViewShell.Header>
        <EmailHeader onSearchEscape={props.onSearchEscape} />
      </ViewShell.Header>
      <ViewShell.Content>{props.children}</ViewShell.Content>
    </>
  );

  return (
    <ViewShell.Root
      asidePreferenceKey="email"
      resizable
      aside={{ preserveDuringResize: false }}
      main={{ preferredWidth: 640 }}
    >
      <ViewShell.Aside>
        <EmailSidebar />
      </ViewShell.Aside>
      <ViewShell.Main>
        <SplitRouter.Outlet fallback={list} />
      </ViewShell.Main>
    </ViewShell.Root>
  );
}

const MOBILE_EMAIL_TABS: PillTabItem<EmailTab>[] = EMAIL_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
}));

function EmailMobileLayout(props: ParentProps) {
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
            items={MOBILE_EMAIL_TABS}
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
  const { state } = useEmailView();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();

  onMount(() => panel.handle.setDisplayName('Email'));

  const list = () => (
    <Suspense fallback={<EmailListFallback />}>
      <Show
        when={state.tab === 'scheduled'}
        fallback={<EmailList ref={setListElement} />}
      >
        <ScheduledEmailList ref={setListElement} />
      </Show>
    </Suspense>
  );

  return (
    <StaticMarkdownContext>
      <SplitPanel.Root>
        <SplitPanel.Body>
          <Show
            when={isTouchDevice()}
            fallback={
              <EmailDesktopLayout onSearchEscape={() => listElement()?.focus()}>
                {list()}
              </EmailDesktopLayout>
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
