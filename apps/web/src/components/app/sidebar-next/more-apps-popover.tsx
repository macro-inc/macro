import { sidebarContent } from '@components/app/app-sidebar/sidebar';
import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { Button, Dropdown } from '@ui';
import { For } from 'solid-js';
import { NavGlyph } from './nav-glyph';
import { type SidebarNextNavItem, visibleNavItems } from './nav-items';
import { splitContentUrl } from './urls';
import { useNavItemGates } from './use-nav-item-gates';

/** An app link in the overflow menu, opening in a new browser tab. */
const AppItem = (props: { item: SidebarNextNavItem }) => {
  const url = () =>
    splitContentUrl(sidebarContent(props.item.id, props.item.params));

  return (
    <Dropdown.Item
      as={(linkProps) => (
        <a
          {...linkProps}
          href={url()}
          target="_blank"
          rel="noopener noreferrer"
        />
      )}
      draggable={false}
      data-sidebar-next-tile={props.item.id}
      class="gap-3 rounded-lg px-3 py-2"
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
      <NavGlyph icon={props.item.icon} class="size-5 text-ink-muted" />
      <span class="max-w-full truncate">{props.item.label}</span>
    </Dropdown.Item>
  );
};

/** Overflow dropdown below the main apps, with links to open a new tab. */
export const MoreAppsPopover = (props: {
  onOpenChange?: (open: boolean) => void;
}) => {
  const gates = useNavItemGates();

  return (
    <Dropdown
      onOpenChange={props.onOpenChange}
      placement="right-start"
      gutter={8}
    >
      <Dropdown.Trigger
        as={Button}
        size="icon-md"
        variant="ghost"
        class="text-ink-subtle hover:text-ink rounded-xl"
        label="More apps"
      >
        <DotsThreeIcon class="size-5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-48 rounded-xl">
        <Dropdown.Group class="rounded-xl p-1">
          <For each={visibleNavItems(gates())}>
            {(item) => <AppItem item={item} />}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
