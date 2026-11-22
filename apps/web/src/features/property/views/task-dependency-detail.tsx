import { t } from '@app/lib/i18n';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { buildSimpleEntityUrl } from '@core/util/url';
import { TaskBlockedBadge } from '@entity/components/TaskBlockedBadge';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { createTaskDependencyQuery } from '@queries/properties/graphql/task-dependency-source';
import { For, Show, Suspense } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';

function TaskDependencyLink(props: { taskId: string }) {
  const [preview, { documentProperties }] = useItemPreview(() => ({
    type: 'document',
    id: props.taskId,
  }));
  const task = () => {
    const item = preview();
    return isAccessiblePreviewItem(item) ? item : undefined;
  };
  const statusId = () => {
    const status = documentProperties()?.properties?.find(
      (property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
    );
    return status?.valueType === 'SELECT_STRING'
      ? status.value?.[0]
      : undefined;
  };
  return (
    <Show
      when={task()}
      fallback={
        <span class="text-ink-muted">
          {preview().loading
            ? t('entityActions.taskLoading')
            : t('entityActions.taskUnavailable')}
        </span>
      }
    >
      {(task) => (
        <a
          class="inline-flex min-h-11 max-w-full items-center gap-1.5 text-ink hover:underline"
          href={buildSimpleEntityUrl({ type: 'task', id: props.taskId })}
        >
          <TaskStatusIcon statusId={statusId()} size="xs" />
          <span class="truncate">
            {task().name || t('entityActions.taskUntitled')}
          </span>
        </a>
      )}
    </Show>
  );
}

/** Shared task detail dependency strip; unavailable tasks never reveal their names. */
export function TaskDependencyDetail(props: { taskId: string }) {
  const query = createTaskDependencyQuery(() => props.taskId);
  const state = () => query.data?.taskDependencies;
  const blockers = () => {
    const value = state()?.properties.find(
      (property) =>
        property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.DEPENDS_ON
    )?.value;
    return value?.__typename === 'GraphqlEntityReferencePropertyValue'
      ? value.references
      : [];
  };
  return (
    <Suspense>
      <Show when={blockers().length > 0}>
        <div class="flex basis-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal">
          <TaskBlockedBadge blocked={state()?.isBlocked} />
          <span class="text-ink-muted">{t('entityActions.taskDependsOn')}</span>
          <For each={blockers()}>
            {(blocker) => <TaskDependencyLink taskId={blocker.entityId} />}
          </For>
        </div>
      </Show>
      <Show when={query.error}>
        <span role="alert" class="basis-full text-xs text-failure">
          {t('entityActions.taskDependenciesFailed')}
        </span>
      </Show>
    </Suspense>
  );
}
