import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  useAgentVoice,
  useVoicePickerSource,
} from '@queries/team-agents/voices';
import type { TeamAgent } from '@service-auth/generated/schemas';
import { onCleanup, Show, Suspense } from 'solid-js';
import { AgentVoiceForm } from './agent-voice-form';

function ConnectedVoiceSettings(props: {
  teamId: string;
  agent: TeamAgent;
  onClose(): void;
}) {
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const source = useVoicePickerSource(() => props.teamId);
  const { query, update } = useAgentVoice(
    () => props.teamId,
    () => props.agent.userId
  );
  return (
    <AgentVoiceForm
      name={props.agent.name}
      source={source}
      current={queryReadyGate(query) ? query.data.model : undefined}
      loading={query.isLoading}
      loadError={query.isError}
      saving={update.isPending}
      saveError={update.isError}
      onRetry={() => fireAndForget(query.refetch(), 'team-agent.voice.retry')}
      onSave={(model) =>
        update.mutate(model, {
          onSuccess: () => {
            if (active) props.onClose();
          },
        })
      }
      onClose={props.onClose}
    />
  );
}

export function AgentVoiceDialog(props: {
  teamId: string;
  agent: TeamAgent | undefined;
  onClose(): void;
}) {
  return (
    <Show keyed when={props.agent}>
      {(agent) => (
        <Suspense fallback={<p role="status">Loading voice settings…</p>}>
          <ConnectedVoiceSettings
            teamId={props.teamId}
            agent={agent}
            onClose={props.onClose}
          />
        </Suspense>
      )}
    </Show>
  );
}
