import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { JSX } from 'solid-js';
import type { EntityDisplay } from '../components/entity-mention';

/**
 * Resolves one entity's display and the split-aware click handlers that
 * open it. Views own this side effect; UI leaves only render the result.
 */
export function OpenEntity(props: {
  entityId: string;
  entityType: EntityType;
  children: (ctx: {
    display: EntityDisplay;
    handlers: {
      onMouseDown: JSX.EventHandler<HTMLDivElement, MouseEvent>;
      onClick: JSX.EventHandler<HTMLDivElement, MouseEvent>;
    };
  }) => JSX.Element;
}) {
  const display = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );
  const handlers = useSplitNavigationHandler<HTMLDivElement>((event) => {
    const block = display.blockOrFileType();
    if (!block) return;
    openDocument(block, props.entityId, display.linkParams(), event.shiftKey);
  });
  return props.children({ display, handlers });
}
