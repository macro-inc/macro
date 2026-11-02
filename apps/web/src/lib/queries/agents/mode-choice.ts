import { Telemetry } from '@macro-inc/observability';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { AgentMode } from '@service-agent-harness/generated/schemas';

/**
 * Whether the composer's Auto mode sends `prompt` to a chat or a coding agent.
 * Any failure (classifier unconfigured, slow, or out of quota) means Chat, so
 * a send never stalls on the choice.
 */
export function chooseAgentMode(prompt: string): Promise<AgentMode> {
  return Telemetry.span('agent.mode_choice', async (span) => {
    const result = await agentHarnessServiceClient.chooseMode(prompt);
    const mode = result.isOk() ? result.value.mode : 'chat';
    span.setAttr('agent.mode_choice.outcome', mode);
    span.setAttr('agent.mode_choice.fallback', result.isErr());
    return mode;
  });
}
