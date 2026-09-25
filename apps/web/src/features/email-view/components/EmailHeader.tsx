import {
  SearchBar,
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSignal, Show } from 'solid-js';
import { composeEmail } from '../compose-email';
import { EMAIL_TABS } from '../constants';
import { useEmailView } from '../email-view-context';
import { EmailControls } from './EmailControls';
import { EmailInboxFilter, EmailInboxMenu } from './EmailInboxSelector';

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

export function EmailTopBar() {
  return (
    <ViewShell.TopBar>
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <ViewBreadcrumbs.Outlet aria-label="Email location" />
        <EmailInboxFilter class="@max-[720px]/view-shell:hidden" />
      </div>
    </ViewShell.TopBar>
  );
}

export function EmailHeader(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const { state, setState } = useEmailView();
  const [filterOpen, setFilterOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  const selectedTabLabel = () =>
    EMAIL_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Email';

  // The view's control hotkeys are registered once, here, for the split scope.
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search email',
      condition: () => state.tab !== 'scheduled',
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
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
    <div class="flex min-w-0 flex-col">
      <div class="mb-4 hidden min-h-8 min-w-0 flex-wrap items-baseline gap-2 @max-[720px]/view-shell:flex">
        <h1 class="min-w-0 shrink-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
          {selectedTabLabel()}
        </h1>
        <EmailInboxFilter class="@max-[480px]/view-shell:order-3 @max-[480px]/view-shell:w-full" />
        <div class="ml-auto flex shrink-0 items-center self-center gap-2">
          <EmailInboxMenu />
          <div class="shrink-0">
            <SidebarCreateButton
              label="New"
              onCreate={() => composeEmail(openWithSplit, state.inboxIds)}
            />
          </div>
        </div>
      </div>

      <Show when={state.tab !== 'scheduled'}>
        <div class="flex min-w-0 items-center justify-between gap-3">
          <SearchBar
            ref={(element) => (searchInput = element)}
            label="Search email"
            value={state.search}
            hotkey="cmd+f"
            onValueChange={(search) => setState('search', search)}
            onEscape={props.onSearchEscape}
            placeholder="Search email"
            class="max-w-md flex-1"
          />
          <EmailControls
            filterOpen={filterOpen()}
            onFilterOpenChange={setFilterOpen}
          />
        </div>
      </Show>
    </div>
  );
}
