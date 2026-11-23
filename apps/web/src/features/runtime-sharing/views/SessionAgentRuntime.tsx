import { Show } from 'solid-js';
import { useAgentStop } from '../core/agent-stop';
import { AgentRuntime } from './AgentRuntime';
import { AgentStoppedStatus } from './AgentStoppedStatus';

/**
 * The session pane's line about where its agent runs: stopped, with why and
 * how to restart it, when a resident's owner lost its runtime.
 */
export function SessionAgentRuntime(props: { botId: string; class?: string }) {
  const stop = useAgentStop(() => props.botId);
  return (
    <Show
      when={stop()}
      fallback={<AgentRuntime botId={props.botId} class={props.class} />}
    >
      {(current) => <AgentStoppedStatus stop={current()} class={props.class} />}
    </Show>
  );
}
