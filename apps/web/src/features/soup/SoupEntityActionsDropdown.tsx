import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { CopyMenuItem, MenuItem } from '@core/component/ContextMenu';
import type { EntityData } from '@entity';
import { Dropdown } from '@ui';
import { Hotkey } from '@ui/components/Hotkey';
import { type ComponentProps, createSignal, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';
import { createSoupEntityMenuPickers } from './SoupEntityMenuPickers';

type SoupEntityActionsDropdownProps = {
  entity: EntityData;
  list: EntityActionListState;
  viewContext: EntityActionViewContext;
  /** Host-specific items appended after the entity actions. */
  extraItems?: JSX.Element;
  placement?: ComponentProps<typeof Dropdown>['placement'];
  triggerProps?: ComponentProps<typeof Dropdown.Trigger>;
  contentClass?: string;
  /** Trigger content. */
  children: JSX.Element;
};

/**
 * The entity actions of {@link SoupEntityContextMenu} behind a click, for
 * surfaces that show one entity rather than a list of them (a detail header's
 * title menu). Same items, same order, opened from a button instead of a
 * right-click.
 */
export function SoupEntityActionsDropdown(
  props: SoupEntityActionsDropdownProps
) {
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);
  const entities = () => [props.entity];

  const pickers = createSoupEntityMenuPickers({
    entity: () => props.entity,
    entities,
    // The menu is gone by the time a picker opens, so the pickers hang off
    // the trigger, which is still on screen.
    anchor: () => {
      const rect = trigger()?.getBoundingClientRect();
      return rect ? { x: rect.left, y: rect.bottom } : undefined;
    },
  });

  return (
    <>
      <Dropdown
        open={open()}
        onOpenChange={setOpen}
        placement={props.placement ?? 'bottom-start'}
      >
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          {...props.triggerProps}
          ref={setTrigger}
        >
          {props.children}
        </Dropdown.Trigger>
        <Dropdown.Content
          class={
            props.contentClass ?? 'min-w-64 max-w-[min(22rem,calc(100vw-1rem))]'
          }
        >
          <Dropdown.Group>
            <SoupEntityActionsMenu
              entities={entities()}
              list={props.list}
              viewContext={props.viewContext}
              onActionComplete={() => setOpen(false)}
              item={DropdownActionItem}
              copyItem={DropdownCopyActionItem}
              separator={() => (
                <Dropdown.Separator class="my-1.5 h-px border-0 bg-edge-muted" />
              )}
              onSetProject={pickers.openProjectPicker}
              onEditTags={pickers.openTagPicker()}
              extraItems={props.extraItems}
            />
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <pickers.Pickers />
    </>
  );
}

function DropdownActionContent(props: ComponentProps<typeof MenuItem>) {
  return (
    <>
      <Show when={props.icon}>
        {typeof props.icon === 'function' ? (
          <Dynamic component={props.icon} class="size-4 shrink-0" />
        ) : (
          props.icon
        )}
      </Show>
      <Dropdown.ItemLabel
        class={`min-w-0 flex-1 truncate ${props.class ?? ''}`}
      >
        {props.text}
      </Dropdown.ItemLabel>
      <Show when={props.hotkeyToken || props.shortcut}>
        <Hotkey
          token={props.hotkeyToken}
          shortcut={props.shortcut}
          theme="subtle"
          showPlus
        />
      </Show>
    </>
  );
}

function DropdownActionItem(props: ComponentProps<typeof MenuItem>) {
  return (
    <Dropdown.Item
      disabled={props.disabled}
      closeOnSelect={props.closeOnSelect}
      onSelect={props.onClick}
    >
      <DropdownActionContent {...props} />
    </Dropdown.Item>
  );
}

function DropdownCopyActionItem(props: ComponentProps<typeof CopyMenuItem>) {
  return (
    <Dropdown.CopyItem
      disabled={props.disabled}
      onCopy={props.onCopy}
      icon={
        typeof props.icon === 'function' ? (
          <Dynamic component={props.icon} class="size-4 shrink-0" />
        ) : (
          props.icon
        )
      }
    >
      <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
        {props.text}
      </Dropdown.ItemLabel>
      <Show when={props.hotkeyToken || props.shortcut}>
        <Hotkey
          token={props.hotkeyToken}
          shortcut={props.shortcut}
          theme="subtle"
          showPlus
        />
      </Show>
    </Dropdown.CopyItem>
  );
}
