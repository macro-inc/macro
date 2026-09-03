import { SearchBar, useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import MenuIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown } from '@ui';
import { createSignal } from 'solid-js';
import { composeEmail } from '../compose-email';
import { useEmailView } from '../email-view-context';
import { EmailControls } from './EmailControls';
import { EmailInboxSelector } from './EmailInboxSelector';
import { EmailNavigation } from './EmailSidebar';

export type EmailHeaderProps = {
  /** Hands focus back to the list after Escape leaves the search field. */
  onSearchEscape?: () => void;
};

export function EmailHeader(props: EmailHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { state, setState } = useEmailView();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  let filterControl: HTMLDivElement | undefined;

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
        const trigger = filterControl?.querySelector('button');
        trigger?.click();

        return trigger !== null && trigger !== undefined;
      },
    },
  });

  return (
    <div class="flex min-w-0 flex-col">
      <SplitPanel.ControlGroup class="hidden px-2 pb-2 @max-[720px]/view-shell:flex">
        <SplitPanel.CloseButton />
        <SplitPanel.BackButton />
        <SplitPanel.ForwardButton />
      </SplitPanel.ControlGroup>

      {/* Sidebar stand-in while the aside is collapsed: the tab menu, the
          inbox selector, and compose. */}
      <div class="mb-4 hidden min-w-0 items-center gap-2 @max-[720px]/view-shell:flex">
        <Dropdown
          open={navigationOpen()}
          onOpenChange={setNavigationOpen}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            square
            class="size-8 shrink-0 rounded-full"
            aria-label="Open Email navigation"
          >
            <MenuIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-72 rounded-2xl p-2">
            <div class="rounded-xl bg-menu">
              <EmailNavigation onNavigate={() => setNavigationOpen(false)} />
            </div>
          </Dropdown.Content>
        </Dropdown>
        <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
          Email
        </h1>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <EmailInboxSelector variant="compact" />
          <Button
            type="button"
            variant="cta"
            size="md"
            class="rounded-lg px-3"
            onClick={composeEmail}
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
        <EmailControls filterRef={(element) => (filterControl = element)} />
      </div>
    </div>
  );
}
