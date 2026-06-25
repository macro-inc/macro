import type { BlockName } from '@core/block';
import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { ItemEntity } from '@queries/preview';
import { cn } from '@ui';
import { Suspense } from 'solid-js';
import type { EntityRef, WidgetOf } from '../schema';
import { SURFACE } from '../tokens';

/**
 * A rich preview card for a single entity — a task, an md document, or anything
 * else with a preview — by rendering the SAME rich body the list's hover card
 * shows, but
 * INLINE (always visible, not on hover) and inside a NORMAL border instead of
 * the floating hover-card's highlighted chrome.
 *
 * The hover card in {@link import('@core/component/ItemPreview').ItemPreview}
 * renders {@link import('@core/component/DocumentPreview').PopupPreview}, whose
 * outer shell bakes in a colored highlight border + drop shadow. Rather than
 * suppress that chrome with a flag, we COMPOSE: we render the extracted
 * {@link DocumentPreviewContent} body directly and wrap it in our own ordinary
 * card border.
 *
 * Picking `documentInfo.type` is the crux of making BOTH a task and an md doc
 * look like their hover card. `DocumentPreviewContent` gates its body branches
 * (the task status/priority/assignee block, the image cover strip, the
 * copy-branch button) on `documentInfo.type` LITERALLY — it does NOT use the
 * block type it re-resolves internally for those. So a static default like
 * `'document'` would render an md doc fine but would never show a task's task
 * body. We therefore derive the block name from the FETCHED item exactly the
 * way the hover card does — `fileTypeToBlockName(targetType() ?? itemType)`
 * (see ItemPreviewInner's `blockName()`), which resolves the document subType
 * `task` to the `task` block and a plain md doc to `md`. That makes each entity
 * render identically to its hover card. Until the item resolves we fall back to
 * the caller's EntityRef type; the body re-renders once it loads.
 */

export type CardProps = Omit<WidgetOf<'card'>, 'type'>;

/** Map a schema EntityType onto the ItemType string the preview query expects. */
function toItemType(type: EntityRef['type']): string {
  switch (type) {
    case 'email_thread':
      return 'email';
    case 'foreign_entity':
      return 'foreign';
    default:
      return type;
  }
}

export function Card(props: CardProps) {
  const itemEntity = () =>
    ({
      id: props.entity.id,
      type: toItemType(props.entity.type),
    }) as ItemEntity;

  const { item, targetType } = useItemPreviewData(itemEntity);

  // Mirror ItemPreviewInner's `blockName()`: resolve the real block (task / md
  // / …) from the fetched item so the body branches in DocumentPreviewContent
  // match the hover card. Falls back to the caller's EntityRef type pre-load.
  const blockName = (): BlockName => {
    const i = item();
    const resolved =
      !i.loading && i.access === 'access'
        ? fileTypeToBlockName(targetType() ?? i.type)
        : fileTypeToBlockName(props.entity.type);
    return (resolved || props.entity.type) as BlockName;
  };

  const documentInfo = () => ({
    id: props.entity.id,
    type: blockName(),
    params: {},
    isOpenable: true,
  });

  return (
    // DocumentPreviewContent fetches preview + property data; guard with our own
    // boundary so a suspending fetch can't bubble past this widget.
    <Suspense>
      <div
        class={cn(
          'w-full max-w-sm overflow-hidden rounded-lg border text-ink',
          SURFACE.borderMuted,
          SURFACE.panel
        )}
      >
        <DocumentPreviewContent documentInfo={documentInfo()} />
      </div>
    </Suspense>
  );
}
