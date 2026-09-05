import { sidebarContent } from '@components/app/app-sidebar/sidebar';
import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For } from 'solid-js';
import { NavGlyph } from './nav-glyph';
import { type SidebarNextNavItem, visibleNavItems } from './nav-items';
import { splitContentUrl } from './urls';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * One cell of the grid. A real `<a href>` so cmd-click, middle-click and the
 * browser's own "open in new tab" work — the point of the grid. Plain
 * left-click still routes through `openExternalUrl`, because Tauri needs a
 * `_self` navigation to hand the URL to the system browser.
 *
 * The only surface in the rail that isn't a `Button`: it stacks a label under
 * the glyph, and has no active state of its own — every entry opens a new tab —
 * so the outline-to-fill swap runs off hover instead.
 */
const AppTile = (props: { item: SidebarNextNavItem }) => {
  const [hovering, setHovering] = createSignal(false);
  const url = () =>
    splitContentUrl(sidebarContent(props.item.id, props.item.params));

  return (
    <a
      href={url()}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      data-sidebar-next-tile={props.item.id}
      class="flex aspect-square cursor-default select-none flex-col items-center justify-center gap-2 rounded-xl text-[12px] text-ink outline-none transition-colors duration-150 ease-out hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(event) => {
        // Let the browser handle the modified clicks it already does better
        // than we can.
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
        openExternalUrl(new URL(url(), window.location.origin).href);
      }}
    >
      <NavGlyph
        icon={props.item.icon}
        iconActive={props.item.iconActive}
        filled={hovering()}
        class="size-6"
      />
      <span class="max-w-full truncate">{props.item.label}</span>
    </a>
  );
};

/** The grid of every nav, each opening in a new browser tab. */
export const MoreAppsPopover = (props: {
  onOpenChange?: (open: boolean) => void;
}) => {
  const gates = useNavItemGates();

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
          <For each={visibleNavItems(gates())}>
            {(item) => <AppTile item={item} />}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
