import type { AgentSession } from '@core/agent-session/AgentSession';
import {
  type EffortSelection,
  effortConfigOption,
} from '../state/session-config';
import { confirmSessionControl } from './confirm-session-control';

/** Validate against the model's confirmed runtime snapshot before setting effort. */
export async function configureSessionModel(
  session: Pick<AgentSession, 'issue' | 'snapshot' | 'subscribe'>,
  model: string,
  effort?: EffortSelection
) {
  if ((await session.snapshot()).metadata.model !== model) {
    await confirmSessionControl(session, { type: 'setModel', model });
  }
  if (!effort) return;
  const option = effortConfigOption(
    (await session.snapshot()).metadata.configOptions
  );
  if (
    option?.id !== effort.configId ||
    !option.options.some((choice) => choice.value === effort.value)
  ) {
    throw new Error('The selected model no longer supports this effort.');
  }
  if (option.currentValue === effort.value) return;
  await confirmSessionControl(session, {
    type: 'setConfigOption',
    configId: effort.configId,
    value: effort.value,
  });
}
