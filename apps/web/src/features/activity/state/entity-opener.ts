import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import { type ActivityEntityType, toPropertyEntityType } from '../core/event';
import type { ActivityDeps, EntityDisplay, OpenEntityTarget } from '../deps';

export type EntityOpener = {
  display: EntityDisplay;
  /** Present only when the host handles opens. */
  handlers?: {
    onMouseDown: JSX.EventHandler<HTMLDivElement, MouseEvent>;
    onClick: JSX.EventHandler<HTMLDivElement, MouseEvent>;
  };
};

/**
 * Resolves an entity's display and, when the host supplies `onOpen`, the
 * split-aware click handlers that hand it a target (shift-click asks for a
 * new split). Undefined for entity kinds the app cannot link to.
 */
export function createEntityOpener(
  deps: Pick<ActivityDeps, 'entityDisplay'>,
  entityId: Accessor<string>,
  entityType: Accessor<ActivityEntityType>,
  onOpen: ((target: OpenEntityTarget) => void) | undefined
): Accessor<EntityOpener | undefined> {
  return createMemo(() => {
    const type = toPropertyEntityType(entityType());
    if (!type) return undefined;
    const display = deps.entityDisplay(entityId, () => type);
    if (!onOpen) return { display };
    const handlers = useSplitNavigationHandler<HTMLDivElement>((event) => {
      const block = display.blockOrFileType();
      if (!block) return;
      onOpen({
        block,
        id: entityId(),
        params: display.linkParams(),
        newSplit: event.shiftKey,
      });
    });
    return { display, handlers };
  });
}
