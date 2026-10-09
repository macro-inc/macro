import type { AgentSession } from '@core/agent-session/AgentSession';
import {
  type EffortSelection,
  effortConfigOption,
} from '../state/session-config';
import { confirmSessionControl } from './confirm-session-control';

/**
 * Resolve once the runtime has reported its configuration. A new session's
 * fold may be loaded before the `session/new` reply lands, with nothing yet to
 * compare a model or effort against.
 */
export function sessionConfigReported(
  session: Pick<AgentSession, 'snapshot' | 'subscribe'>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = async () => {
      try {
        const snapshot = await session.snapshot();
        if (snapshot.metadata.configOptions.length > 0) finish();
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Could not read the session configuration.')
        );
      }
    };
    const timeout = setTimeout(
      () => finish(new Error('The agent did not report its configuration.')),
      60_000
    );
    const unsubscribe = session.subscribe(() => void inspect());
    void inspect();
  });
}

/** Validate against the model's confirmed runtime snapshot before setting effort. */
export async function configureSessionModel(
  session: Pick<AgentSession, 'issue' | 'snapshot' | 'subscribe'>,
  model: string | undefined,
  effort?: EffortSelection
) {
  if (model && (await session.snapshot()).metadata.model !== model) {
    await confirmSessionControl(session, { type: 'setModel', model });
  }
  if (!effort) return;
  const options = (await session.snapshot()).metadata.configOptions;
  const candidate = options.find((option) => option.id === 'speed');
  const option =
    effort.configId === 'speed'
      ? candidate?.type === 'select'
        ? candidate
        : undefined
      : effortConfigOption(options);
  if (
    option?.id !== effort.configId ||
    !option.options.some((choice) => choice.value === effort.value)
  ) {
    throw new Error(
      `The selected model no longer supports this ${effort.configId === 'speed' ? 'speed' : 'effort'}.`
    );
  }
  if (option.currentValue === effort.value) return;
  await confirmSessionControl(session, {
    type: 'setConfigOption',
    configId: effort.configId,
    value: effort.value,
  });
}
