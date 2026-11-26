import { TaskTimePill } from '@app/features/time-tracking/task-time-pill';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { useEntityProperties } from '@property/hooks';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { type JSX, Show, Suspense } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';

function TimeLogged(props: { taskId: string; canEdit: boolean }): JSX.Element {
  const { properties } = useEntityProperties(props.taskId, 'TASK', false);
  const minutes = () => {
    const property = properties().find(
      (candidate) =>
        candidate.propertyDefinitionId === SYSTEM_PROPERTY_IDS.TIME_LOGGED
    );
    return property?.valueType === 'NUMBER' ? (property.value ?? 0) : 0;
  };
  return (
    <TaskTimePill
      taskId={props.taskId}
      minutes={minutes()}
      canEdit={props.canEdit}
    />
  );
}

/** The task's Time pill in its property row, behind `enable-time-tracking`. */
export function InlineTaskTimeLogged(): JSX.Element {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={kind() === 'task' && flag().enabled}>
      <Suspense>
        <TimeLogged taskId={documentId()} canEdit={permissions.canEdit()} />
      </Suspense>
    </Show>
  );
}
