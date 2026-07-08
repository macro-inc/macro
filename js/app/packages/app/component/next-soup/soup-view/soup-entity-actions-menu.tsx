import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import type { EntityData } from '@entity';
import { For, Show } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './create-soup-entity-actions';
import { useSoupView } from './soup-view-context';

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  soup: SoupState;
  onActionComplete?: () => void;
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const panel = useSplitPanelOrThrow();
  const { activeTab } = useSoupView();
  const { buildActionGroups } = createSoupEntityActions();

  const groups = () => {
    const content = panel.handle.content();
    return buildActionGroups(props.soup, props.entities, {
      activeTab: activeTab(),
      activeListView: content.id,
      viewedProjectId: viewedProjectIdFromContent(content),
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
