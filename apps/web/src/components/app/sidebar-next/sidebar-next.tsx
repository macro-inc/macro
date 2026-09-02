import {
  goToHotkeyVisible,
  registerSidebarHotkeys,
  type SidebarState,
} from '@components/app/app-sidebar/sidebar';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import LogoIcon from '@icon/macro-logo.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { For } from 'solid-js';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { ListNav } from './list-nav';
import { visibleNavItems } from './nav-items';
import { SearchBarButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';

export type SidebarNextProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
};

/**
 * The rebuilt app sidebar, behind `enable-sidebar-next`.
 *
 * Expanded-only by design: there is no slim rail and no hover-peek overlay, so
 * `cmd+.` hides the sidebar outright rather than collapsing it to icons. The
 * `g`-prefixed nav shortcuts are unaffected — `GoToHotkeys` is mounted from
 * `Layout` and does not depend on which sidebar renders.
 */
export const SidebarNext = (props: SidebarNextProps) => {
  const currentTeamQuery = useCurrentTeamQuery();
  const gates = useNavItemGates();

  const teamName = () => currentTeamQuery.data?.team.name?.trim();
  const isExpanded = () => (props.sidebarState ?? 'expanded') === 'expanded';

  // `cmd+.` lives on the rendered sidebar, so SidebarNext has to register it
  // too or the shortcut goes dead whenever this replaces `AppSidebar`.
  registerSidebarHotkeys({
    isSlim: () => !isExpanded(),
    onOpenChange: props.onOpenChange,
  });

  return (
    <div
      {...hotkeyScopeNeutralAttribute}
      data-ui="sidebar-next"
      class="relative flex h-full w-55 shrink-0 flex-col gap-2 overflow-hidden bg-surface px-3 pb-3 pt-4 text-[13px]"
    >
      {/* Logo and create button share the left edge. */}
      <div class="flex shrink-0 items-center gap-4 pl-2 mb-2">
        <div class="flex size-6 shrink-0 items-center justify-center text-accent">
          <LogoIcon class="size-6" />
        </div>
        <SidebarRailCreateButton />
      </div>

      <SearchBarButton />

      <nav class="shrink-0 pt-16">
        <ul class="flex flex-col gap-2">
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <ListNav item={item} hotkeyVisible={goToHotkeyVisible()} />
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="min-h-0 flex-1" />

      <FooterActions />
    </div>
  );
};
