import { CommandState } from '@app/features/command';
import { TOKENS } from '@core/hotkey/tokens';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Hotkey } from '@ui';
import { SidebarItemNext } from './sidebar-item-next';

/**
 * The full-width bar under the header. Styled as a search input but it is a
 * button: it opens the command menu, which is the app's search surface.
 */
export const SearchBarButton = () => (
  <SidebarItemNext
    variant="search"
    label="Search"
    icon={MagnifyingGlassIcon}
    data-sidebar-next-search=""
    onClick={() => CommandState.open()}
    trailing={
      <span class="rounded-sm text-xs border border-ink/5 px-1.5 py-0.5 font-normal text-ink-extra-muted">
        <Hotkey token={TOKENS.global.commandMenu} />
      </span>
    }
  >
    <span class="truncate text-ink-extra-muted">Search</span>
  </SidebarItemNext>
);
