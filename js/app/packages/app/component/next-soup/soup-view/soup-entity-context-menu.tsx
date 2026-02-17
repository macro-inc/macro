import { ContextMenuContent, MenuSeparator } from '@core/component/Menu';
import type { DateValue } from '@core/util/date';
import { isMobile } from '@core/mobile/isMobile';
import { ContextMenu } from '@kobalte/core/context-menu';
import { InlineEntity, type EntityData } from '@entity';
import { type FlowComponent, Show } from 'solid-js';
import { useSoupView } from './soup-view-context';
import { SoupEntityActionsMenu } from './soup-entity-actions-menu';

interface SoupEntityContextMenuProps {
  entity: EntityData;
  entityTimestamp?: DateValue | null;
  onOpenChange?: (open: boolean) => void;
}

export const SoupEntityContextMenu: FlowComponent<
  SoupEntityContextMenuProps
> = (props) => {
  const { soup } = useSoupView();

  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger class="size-full">
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <Show when={props.entity}>
          {(selectedEntity) => (
            <ContextMenuContent mobileFullScreen>
              <Show when={isMobile()}>
                <InlineEntity entity={selectedEntity()} />
                <MenuSeparator />
              </Show>
              <SoupEntityActionsMenu
                entities={[selectedEntity()]}
                soup={soup}
              />
            </ContextMenuContent>
          )}
        </Show>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};
