import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import type { EntityData } from '@entity';
import { For, Show } from 'solid-js';
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
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const panel = useSplitPanelOrThrow();
  const { buildActionGroups } = createSoupEntityActions();

  const groups = () => {
    const content = panel.handle.content();
    return buildActionGroups(props.list, props.entities, {
      viewContext: props.viewContext,
      viewedProjectId: viewedProjectIdFromContent(content),
      openTagPicker: props.onEditTags,
      splitHandle: panel.handle,
    });
  };

  const handleAction = async (onClick: () => void | Promise<void>) => {
    await onClick();
    props.onActionComplete?.();
  };

  return (
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
  );
};
