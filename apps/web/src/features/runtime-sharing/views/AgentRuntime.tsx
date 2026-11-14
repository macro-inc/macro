import { t } from '@app/lib/i18n';
import { useAgentsQuery } from '@queries/agents/agents';
import { useRunnableHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { Show } from 'solid-js';
import { RuntimeAccessAction } from '../components/RuntimeAccessAction';

/**
 * Where an agent runs, and a way to ask for that machine when the viewer cannot
 * use it. Nothing for agents with no registered runtime.
 */
export function AgentRuntime(props: { botId: string; class?: string }) {
  const agents = useAgentsQuery();
  const directory = useRunnableHarnessDirectoryQuery();
  const agent = () =>
    agents.isSuccess
      ? agents.data.find((candidate) => candidate.bot.id === props.botId)
      : undefined;
  const runtime = () => {
    const harnessId = agent()?.harness_id;
    if (!harnessId || !directory.isSuccess) return;
    return directory.data.find((harness) => harness.id === harnessId);
  };
  return (
    <Show when={runtime()}>
      {(harness) => (
        <div
          class={props.class}
          data-agent-runtime
          data-runtime-access={harness().access}
        >
          <div class="flex min-h-8 items-center justify-between gap-3">
            <div class="min-w-0 truncate text-xs text-ink-muted">
              {agent()?.is_coding
                ? t('runtimeSharing.runsOn', { name: harness().name })
                : t('runtimeSharing.livesOn', { name: harness().name })}
              {' · '}
              {harness().connected
                ? t('runtimeSharing.online')
                : t('runtimeSharing.offline')}
            </div>
            <Show
              when={harness().access === 'none' || harness().access === 'read'}
            >
              <RuntimeAccessAction harnessId={harness().id} />
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
