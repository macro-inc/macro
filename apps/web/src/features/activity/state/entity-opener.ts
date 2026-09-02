import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Accessor, JSX } from 'solid-js';
import type { ActivityDeps, EntityDisplay } from '../deps';

export type EntityOpenHandlers = {
  onMouseDown: JSX.EventHandler<HTMLDivElement, MouseEvent>;
  onClick: JSX.EventHandler<HTMLDivElement, MouseEvent>;
};

/**
 * Resolves an entity's display and the split-aware handlers that open it.
 * Shift-click asks for a new split.
 */
export function createEntityOpener(
  deps: Pick<ActivityDeps, 'entityDisplay' | 'openEntity'>,
  entityId: Accessor<string>,
  entityType: Accessor<EntityType>
): { display: EntityDisplay; handlers: EntityOpenHandlers } {
  const display = deps.entityDisplay(entityId, entityType);
  const handlers = useSplitNavigationHandler<HTMLDivElement>((event) => {
    const block = display.blockOrFileType();
    if (!block) return;
    deps.openEntity({
      block,
      id: entityId(),
      params: display.linkParams(),
      newSplit: event.shiftKey,
    });
  });
  return { display, handlers };
}
