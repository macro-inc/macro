import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import { type ActivityEntityType, toPropertyEntityType } from '../core/event';
import type { ActivityDeps, EntityDisplay } from '../deps';

export type EntityOpener = {
  display: EntityDisplay;
  handlers: {
    onMouseDown: JSX.EventHandler<HTMLDivElement, MouseEvent>;
    onClick: JSX.EventHandler<HTMLDivElement, MouseEvent>;
  };
};

/**
 * Resolves an entity's display and the split-aware handlers that open it.
 * Undefined for entity kinds the app cannot link to. Shift-click asks for
 * a new split.
 */
export function createEntityOpener(
  deps: Pick<ActivityDeps, 'entityDisplay' | 'openEntity'>,
  entityId: Accessor<string>,
  entityType: Accessor<ActivityEntityType>
): Accessor<EntityOpener | undefined> {
  return createMemo(() => {
    const type = toPropertyEntityType(entityType());
    if (!type) return undefined;
    const display = deps.entityDisplay(entityId, () => type);
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
  });
}
