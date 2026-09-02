import { sidebarContent } from '@components/app/app-sidebar/sidebar';
import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import { Button, Dropdown } from '@ui';
import { For } from 'solid-js';
import { visibleNavItems } from './nav-items';
import { SidebarItemNext } from './sidebar-item-next';
import { splitContentUrl } from './urls';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * The grid of every nav, each opening in a new browser tab.
 *
 * Tiles are real `<a href>`s so cmd-click, middle-click and the browser's own
 * "open in new tab" work — the point of the grid. Plain left-click still routes
 * through `openExternalUrl`, because Tauri needs a `_self` navigation to hand
 * the URL to the system browser.
 */
export const MoreAppsPopover = (props: {
  onOpenChange?: (open: boolean) => void;
}) => {
  const gates = useNavItemGates();
  const items = () => visibleNavItems(gates());

  return (
    <Dropdown onOpenChange={props.onOpenChange} placement="top" gutter={8}>
      <Dropdown.Trigger
        as={Button}
        size="icon-md"
        variant="ghost"
        class="text-ink-subtle hover:text-ink rounded-xl"
        label="More apps"
      >
        <SquaresFourIcon />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 rounded-2xl">
        {/* Group rather than a bare div: it paints the `bg-menu` ground that
            Content's inner `bg-edge-muted` wrapper otherwise shows through. */}
        <Dropdown.Group class="grid grid-cols-3 gap-2 rounded-2xl p-3">
          <For each={items()}>
            {(item) => {
              const url = splitContentUrl(sidebarContent(item.id, item.params));
              return (
                <SidebarItemNext
                  variant="tile"
                  label={item.label}
                  icon={item.icon}
                  iconActive={item.iconActive}
                  iconSwapOn="hover"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-sidebar-next-tile={item.id}
                  onClick={(event) => {
                    // Let the browser handle the modified clicks it already
                    // does better than we can.
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                    if (!isTauri()) return;
                    event.preventDefault();
                    openExternalUrl(new URL(url, window.location.origin).href);
                  }}
                />
              );
            }}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
