import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { EntityData } from '@entity';
import { Dropdown } from '@ui';
import { type ComponentProps, createSignal, type JSX } from 'solid-js';
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
      <Dropdown placement={props.placement ?? 'bottom-start'}>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          {...props.triggerProps}
          ref={setTrigger}
        >
          {props.children}
        </Dropdown.Trigger>
        <Dropdown.Content
          class={props.contentClass ?? 'w-64 text-xs text-ink-muted'}
        >
          <Dropdown.Group>
            <SoupEntityActionsMenu
              entities={entities()}
              list={props.list}
              viewContext={props.viewContext}
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
