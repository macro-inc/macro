import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { MenuItem } from '@core/component/ContextMenu';
import type { EntityData } from '@entity';
import { For, Show } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import { createSoupEntityActions } from './create-soup-entity-actions';
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

  const groups = () =>
    buildActionGroups(props.soup, props.entities, {
      activeTab: activeTab(),
      activeListView: panel.handle.content().id,
    });

  const handleAction = async (onClick: () => void | Promise<void>) => {
    await onClick();
    props.onActionComplete?.();
  };

  return (
    <For each={groups()}>
      {(group, groupIndex) => (
        <>
          <Show when={groupIndex() > 0}>
            <Divider />
          </Show>
          <For each={group.items}>
            {(action) => (
              <MenuItem
                text={action.label}
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

const Divider = () => <div class="border-b border-edge-muted w-full my-1" />;
