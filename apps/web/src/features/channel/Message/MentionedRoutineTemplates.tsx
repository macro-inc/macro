import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineSharing } from '@core/constant/featureFlags';
import { getDocumentMentions } from '@core/util/documentMentions';
import { lazyNamed } from '@core/util/lazyNamed';
import { createMemo, For, Show, Suspense } from 'solid-js';

const RoutineTemplateCard = lazyNamed(
  () => import('@app/features/routines/routine-template'),
  'RoutineTemplateCard'
);

/**
 * Routines mentioned in a message that are shared as templates, as cards
 * beneath its text that people can view or activate for themselves.
 */
export function MentionedRoutineTemplates(props: { content: string }) {
  const routineIds = createMemo(() =>
    getDocumentMentions(props.content)
      .filter(
        (mention) =>
          mention.blockName === 'routine' || mention.blockName === 'automation'
      )
      .map((mention) => mention.documentId)
  );
  return (
    <ShowFeatureFlag flag={enableRoutineSharing}>
      <Show when={routineIds().length > 0}>
        <Suspense>
          <For each={routineIds()}>
            {(routineId) => <RoutineTemplateCard routineId={routineId} />}
          </For>
        </Suspense>
      </Show>
    </ShowFeatureFlag>
  );
}
