import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineCodeSteps } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { getDefaultTimezone } from '@core/util/cron';
import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { type Accessor, onCleanup } from 'solid-js';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import { RoutineDescribe } from './components/routine-describe';
import type { ScheduleDraft } from './core/draft';
import {
  type ComposerContext,
  composeRoutine,
} from './queries/compose-routine';
import { useEmailLabelNames, useRoutineTags } from './queries/step-sources';

/**
 * What the composer knows about the user's workspace, read when AI drafts:
 * names and ids of their labels, tags, channels, folders, people and agents.
 */
export function useComposerContext(options: {
  defaultModel: Accessor<string>;
  decisionsEnabled: Accessor<boolean>;
}): () => ComposerContext {
  const labels = useEmailLabelNames();
  const tags = useRoutineTags();
  const channels = useChannelsContext();
  const roster = createAgentRosterSource();
  const folders = useQuickAccessEntities(() => 'PROJECT');
  const people = useQuickAccessEntities(() => 'USER');
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const named = (
    items: readonly { id: string; data: { name?: string | null } }[]
  ) =>
    items.flatMap((item) =>
      item.data.name ? [{ name: item.data.name, id: item.id }] : []
    );
  return () => ({
    timezone: getDefaultTimezone(),
    defaultModel: options.defaultModel(),
    labels: labels(),
    tags: tags().map(({ label, definitionId, optionId }) => ({
      label,
      definitionId,
      optionId,
    })),
    channels: channels
      .channels()
      .flatMap((channel) =>
        channel.name ? [{ name: channel.name, id: channel.id }] : []
      ),
    folders: named(folders.items()),
    people: named(people.items()),
    agents: roster
      .roster()
      .flatMap((agent) =>
        agent.botId ? [{ name: agent.name, botId: agent.botId }] : []
      ),
    decisions: options.decisionsEnabled(),
    codeSteps: codeSteps().enabled,
  });
}

/** Draft a new routine from a description, using the user's workspace names. */
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
  // way, so it can't replace what the user picked.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const describe = async (description: string) => {
    const draft = await composeRoutine(description, context());
    if (disposed) return undefined;
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
