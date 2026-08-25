import { SidePanel } from '@components/app/side-panel';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import type { ItemType } from '@service-storage/client';
import { createMemo, Show, Suspense } from 'solid-js';
import { References } from './References';

/**
 * The canonical "References" side-panel section: the channel messages and
 * documents that mention this entity.
 *
 * Self-hiding — it renders nothing until the entity has at least one
 * reference, so a panel can mount it unconditionally. Every entity type the
 * references endpoint accepts works here: the endpoint keys on the raw
 * `entity_type` string that mentions and attachments are recorded under, so a
 * type is supported as soon as something can mention it.
 *
 * Must be a descendant of `<SidePanel.Layout>`.
 */
export function EntityReferencesSection(props: {
  entityId: string;
  /** Defaults to `document`, matching {@link References}. */
  entityType?: ItemType;
  /** Render order within the panel — lower numbers appear first. */
  order?: number;
}) {
  const references = useAttachmentReferencesQuery(
    () => props.entityId,
    () => props.entityType ?? 'document'
  );

  const count = createMemo(() => references.data?.length ?? 0);

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={props.order}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <div class="text-xs">
            <References
              documentId={props.entityId}
              entityType={props.entityType}
            />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}
