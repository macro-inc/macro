import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import type {
  ActivityContext,
  EntityDisplay,
  OpenEntityTarget,
} from '../context/activity-context';
import { type ActivityEntityType, toPropertyEntityType } from '../core/event';

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
  context: Pick<ActivityContext, 'entityDisplay'>,
  entityId: Accessor<string>,
  entityType: Accessor<ActivityEntityType>,
  onOpen: ((target: OpenEntityTarget) => void) | undefined
): Accessor<EntityOpener | undefined> {
  return createMemo(() => {
    const type = toPropertyEntityType(entityType());
    if (!type) return undefined;
    const display = context.entityDisplay(entityId, () => type);
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
