import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { enableProjects } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { ProjectChip } from './components/project-chip';
import { openProject } from './open-project';
import { useProjectIdentityQuery } from './queries/project-identity';

/** Native project attachment adapter for channel messages and channel files. */
export function ProjectAttachment(props: { id: string }) {
  return (
    <ShowFeatureFlag flag={enableProjects}>
      <ProjectAttachmentContent id={props.id} />
    </ShowFeatureFlag>
  );
}

function ProjectAttachmentContent(props: { id: string }) {
  const layout = useSplitLayout();
  const userId = useUserId();
  const query = useProjectIdentityQuery(() => props.id, userId);
  return (
    <Show
      when={!query.isPending}
      fallback={<span class="text-sm text-ink-muted">Loading project…</span>}
    >
      <ProjectChip
        reference={
          !query.isError && query.isSuccess
            ? { state: 'visible', id: query.data.id, name: query.data.name }
            : { state: 'unavailable' }
        }
        onOpen={(id, event) =>
          openProject(layout, id, { newSplit: event.shiftKey })
        }
      />
    </Show>
  );
}
