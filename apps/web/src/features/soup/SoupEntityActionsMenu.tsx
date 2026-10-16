import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import type { EntityData } from '@entity';
import { children, For, type JSX, Show } from 'solid-js';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './createSoupEntityActions';

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  list: EntityActionListState;
  viewContext: EntityActionViewContext;
  onActionComplete?: () => void;
  onEditTags?: () => void;
  onSetProject?: () => void;
  /** Host-specific items shown after the entity actions. */
  extraItems?: JSX.Element;
  /** A list that completes its own rows, such as Home's work feed. */
  markDoneDelegate?: () => MarkDoneDelegate | undefined;
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const panel = useSplitPanelOrThrow();
  const { buildActionGroups } = createSoupEntityActions({
    markDoneDelegate: () => props.markDoneDelegate?.(),
  });
  // Resolved rather than tested as JSX: a host whose items render nothing
  // (label rows behind a flag, say) still passes a truthy element, and
  // separating on that alone leaves a divider under the last action.
  const extraItems = children(() => props.extraItems);
  const hasExtraItems = () => extraItems.toArray().length > 0;

  const groups = () => {
    const content = panel.handle.content();
    return buildActionGroups(props.list, props.entities, {
      viewContext: props.viewContext,
      viewedProjectId: viewedProjectIdFromContent(content),
      openTagPicker: props.onEditTags,
      openProjectPicker: props.onSetProject,
      splitHandle: panel.handle,
    });
  };

  const handleAction = async (onClick: () => void | Promise<void>) => {
    await onClick();
    props.onActionComplete?.();
  };

  return (
    <>
      <For each={groups()}>
        {(group, groupIndex) => (
          <>
            <Show when={groupIndex() > 0}>
              <MenuSeparator />
            </Show>
            <For each={group.items}>
              {(action) => (
                <MenuItem
                  text={action.label}
                  icon={action.icon}
                  hotkeyToken={action.hotkeyToken}
                  shortcut={action.shortcut}
                  disabled={action.disabled}
                  onClick={() => handleAction(action.onClick)}
                  class={action.destructive ? 'text-failure-ink' : undefined}
                />
              )}
            </For>
          </>
        )}
      </For>
      <Show when={hasExtraItems()}>
        <Show when={groups().length > 0}>
          <MenuSeparator />
        </Show>
        {extraItems()}
      </Show>
    </>
  );
};
