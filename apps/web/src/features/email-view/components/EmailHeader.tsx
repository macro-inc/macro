import {
  SearchBar,
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, pressHandlers } from '@ui';
import { createSignal } from 'solid-js';
import { composeEmail } from '../compose-email';
import { EMAIL_TABS } from '../constants';
import { useEmailView } from '../email-view-context';
import { EmailControls } from './EmailControls';
import { EmailInboxMenu } from './EmailInboxSelector';
import { EmailNavigation } from './EmailSidebar';

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
      <SplitPanel.CloseButton class="hidden shrink-0 @max-[720px]/view-shell:flex" />
      <ViewBreadcrumbs.Outlet class="flex-1" aria-label="Email location" />
    </ViewShell.TopBar>
  );
}

export function EmailHeader(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { state, setState } = useEmailView();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
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
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
    filter: {
      description: 'Filter email',
      run: () => {
        setFilterOpen(true);
        return true;
      },
    },
  });

  return (
    <div class="flex min-w-0 flex-col">
      {/* Sidebar stand-in while the aside is collapsed: the tab menu, the
          inbox selector, and compose. */}
      <div class="mb-4 hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
        <Dropdown
          open={navigationOpen()}
          onOpenChange={setNavigationOpen}
          placement="bottom-start"
        >
          <h1 class="min-w-0">
            <Dropdown.Trigger
              variant="ghost"
              size="sm"
              class="h-auto min-w-0 max-w-full gap-1 rounded-lg px-2 py-1 text-xl font-semibold tracking-[-0.03em] text-ink"
              aria-label={`Select email view: ${selectedTabLabel()}`}
            >
              <span class="truncate">{selectedTabLabel()}</span>
              <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
            </Dropdown.Trigger>
          </h1>
          <Dropdown.Content class="w-72 rounded-2xl p-2">
            <div class="rounded-xl bg-menu">
              <EmailNavigation onNavigate={() => setNavigationOpen(false)} />
            </div>
          </Dropdown.Content>
        </Dropdown>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <EmailInboxMenu />
          <Button
            type="button"
            variant="cta"
            size="md"
            class="rounded-lg px-3 transition-none"
            {...pressHandlers(() => composeEmail())}
          >
            <PlusIcon class="size-4 shrink-0" />
            New
          </Button>
        </div>
      </div>

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
    </div>
  );
}
