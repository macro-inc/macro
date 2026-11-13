import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineCodeSteps } from '@core/constant/featureFlags';
import { getDefaultTimezone } from '@core/util/cron';
import { type Accessor, onCleanup } from 'solid-js';
import { RoutineDescribe } from './components/routine-describe';
import type { ScheduleDraft } from './core/draft';
import {
  type ComposerContext,
  composeRoutine,
} from './queries/compose-routine';

/** What the composer tells AI when it drafts: what it may write. */
export function useComposerContext(options: {
  defaultModel: Accessor<string>;
  decisionsEnabled: Accessor<boolean>;
}): () => ComposerContext {
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  return () => ({
    timezone: getDefaultTimezone(),
    defaultModel: options.defaultModel(),
    decisions: options.decisionsEnabled(),
    codeSteps: codeSteps().enabled,
  });
}

/** Draft a new routine from a description. */
export function RoutineAiComposer(props: {
  /** Use a drafted routine, remembering the description it came from. */
  apply(draft: ScheduleDraft, description: string): void;
  current: Accessor<ScheduleDraft>;
  initialDescription?: string;
  defaultModel: string;
  decisionsEnabled: boolean;
  disabled?: boolean;
}) {
  const context = useComposerContext({
    defaultModel: () => props.defaultModel,
    decisionsEnabled: () => props.decisionsEnabled,
  });
  // Leaving for a template or a blank routine discards a draft still on its
  // way, so it can't replace what the user picked, and it isn't sent again.
  const left = new AbortController();
  onCleanup(() => left.abort());
  const describe = async (description: string) => {
    const draft = await composeRoutine(description, context(), left.signal);
    if (left.signal.aborted) return undefined;
    if (typeof draft === 'string') return draft;
    props.apply(
      {
        ...draft,
        name: draft.name || props.current().name,
        enabled: props.current().enabled ?? true,
      },
      description
    );
    return undefined;
  };
  return (
    <RoutineDescribe
      onDescribe={describe}
      initialValue={props.initialDescription}
      disabled={props.disabled}
    />
  );
}
