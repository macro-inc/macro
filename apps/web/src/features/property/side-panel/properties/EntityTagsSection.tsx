import { t } from '@app/lib/i18n';
import { SidePanel } from '@components/app/side-panel/SidePanel';
import { useIsAuthenticated } from '@core/auth';
import Plus from '@icon/system/regular/plus.svg';
import { isTaggableEntityType, TagsRow } from '@property/tags';
import { TagPicker } from '@property/tags/TagPicker';
import { useDocTags } from '@property/tags/useDocTags';
import { useTagsQuery } from '@queries/properties/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { buttonClasses } from '@ui';
import { Show, Suspense } from 'solid-js';

export interface EntityTagsSectionProps {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  order?: number;
}

export function EntityTagsSection(props: EntityTagsSectionProps) {
  const tagsQuery = useTagsQuery();
  const isAuthenticated = useIsAuthenticated();
  const isAvailable = () => isAuthenticated() !== false && !tagsQuery.isError;

  return (
    <Show when={isTaggableEntityType(props.entityType)}>
      <SidePanel.Section
        id="tags"
        title="Tags"
        defaultOpen
        order={props.order}
        actions={
          <Show when={props.canEdit && isAvailable()}>
            <TagPicker
              createDocTags={() => useDocTags(props.entityId, props.entityType)}
              triggerClass={buttonClasses({
                variant: 'ghost',
                size: 'icon-xs',
                class: 'text-ink-extra-muted',
              })}
              triggerLabel={t('common.addTags')}
            >
              <Plus class="size-4" />
            </TagPicker>
          </Show>
        }
      >
        <Show
          when={isAvailable()}
          fallback={
            <span class="text-xs text-ink-extra-muted">Tags unavailable</span>
          }
        >
          <Suspense fallback={<SidePanel.Loading />}>
            <div class="text-xs">
              <TagsRow
                entityId={props.entityId}
                entityType={props.entityType}
                canEdit={props.canEdit}
                triggerVariant="pill"
              />
            </div>
          </Suspense>
        </Show>
      </SidePanel.Section>
    </Show>
  );
}
