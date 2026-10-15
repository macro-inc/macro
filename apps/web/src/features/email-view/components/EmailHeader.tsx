import {
  SearchBar,
  SidebarActionRow,
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { useSidebarSearchFocus } from '@app/components/view-shell/SidebarActionRow';
import { SidebarCreateAction } from '@app/components/view-shell/SidebarCreateAction';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TabsInset } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { composeEmail } from '../compose-email';
import { EMAIL_TABS } from '../constants';
import { useEmailView } from '../email-view-context';
import { EMAIL_TOUR } from '../tour';
import { EmailControls } from './EmailControls';
import { EmailInboxMenu } from './EmailInboxSelector';

export type EmailHeaderProps = {
  /** Restores list focus when Escape leaves the search field. */
  onSearchEscape?: () => void;
};

export function EmailViewBreadcrumbItem() {
  const { state } = useEmailView();
  const tabTitle = () =>
    EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email';

  return (
    <ViewBreadcrumbs.Item
      value="email-view"
      metadata={{ type: 'email-view' }}
      order={0}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          class="shrink-0 rounded-md hover:bg-hover"
          isActive={item.isActive()}
          onClick={item.onSelect}
        >
          <span class="truncate @max-[720px]/view-shell:hidden">
            {tabTitle()}
          </span>
          <span class="hidden @max-[720px]/view-shell:inline">Email</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function EmailTopBar(props: ParentProps = {}) {
  const { state, setTab } = useEmailView();
  const isInbox = () => state.tab === 'important' || state.tab === 'noise';

  return (
    <ViewShell.TopBar
      controls={
        <div class="flex min-w-0 items-center gap-2">{props.children}</div>
      }
      workspaceActions
      class="h-12 gap-3 px-4 not-touch:pl-4 touch:flex touch:mt-[var(--safe-top,0px)]"
    >
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <Show when={isInbox()}>
          <h1 class="min-w-0 truncate text-ink">Inbox</h1>
        </Show>
        <div class="shrink-0" ref={tourTarget(EMAIL_TOUR.signalNoise)}>
          <TabsInset
            aria-label="Inbox view"
            class="h-8"
            labelClass="px-3 py-1 text-sm"
            value={isInbox() ? state.tab : ''}
            list={[
              { value: 'important', label: 'Signal' },
              { value: 'noise', label: 'Noise' },
            ]}
            onChange={(tab) => {
              if (tab === 'important' || tab === 'noise') setTab(tab);
            }}
          />
        </div>
        <Show when={!isInbox()}>
          <ViewBreadcrumbs.Outlet aria-label="Email location" />
        </Show>
      </div>
    </ViewShell.TopBar>
  );
}

export function EmailHeader() {
  const panel = useSplitPanelOrThrow();
  const { state } = useEmailView();
  const [filterOpen, setFilterOpen] = createSignal(false);
  // The view's control hotkeys are registered once, here, for the split scope.
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter email',
      condition: () => state.tab !== 'scheduled',
      run: () => {
        setFilterOpen(true);
        return true;
      },
    },
  });

  return (
    <EmailTopBar>
      <div class="flex shrink-0 items-center gap-1">
        <EmailInboxMenu />
        <Show when={state.tab !== 'scheduled'}>
          <EmailControls
            filterOpen={filterOpen()}
            onFilterOpenChange={setFilterOpen}
          />
        </Show>
      </div>
    </EmailTopBar>
  );
}

export function EmailPrimaryActions(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const { state, setState, setTab, closeThread } = useEmailView();
  let searchInput: HTMLInputElement | undefined;
  const focusSearch = useSidebarSearchFocus(() => searchInput);
  const searchTarget = tourTarget(EMAIL_TOUR.search);
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search email',
      run: () => {
        closeThread();
        focusSearch();
        return true;
      },
    },
  });
  return (
    <SidebarActionRow
      title="Email"
      onSearch={() => {
        closeThread();
        focusSearch();
      }}
      search={
        <SearchBar
          ref={(element) => {
            searchInput = element;
            searchTarget(element);
          }}
          onEscape={props.onSearchEscape}
          label="Search email"
          value={state.search}
          placeholder="Search emails"
          onValueChange={(search) => {
            if (state.tab === 'scheduled' || state.tab === 'reminders')
              setTab('all');
            setState('search', search);
            closeThread();
          }}
        />
      }
      create={() => (
        <SidebarCreateAction
          aria-label="New email"
          onClick={() => composeEmail(openWithSplit, state.inboxIds)}
        >
          New
        </SidebarCreateAction>
      )}
    />
  );
}
