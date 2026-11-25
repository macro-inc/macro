import type { AgentState, WakeContext } from '@macro-inc/muppet/core/agent';
import { systemPromptFor } from '@macro-inc/muppet/runtimes/pieces';
import type { BrainJob, PromptPins } from './contracts.ts';

type TrustedPromptInputs = {
  readonly state: AgentState;
  readonly constitution?: Pick<PromptPins['constitution'], 'repoHeadSha'> & {
    readonly bytes: Uint8Array;
  };
  /** Bytes resolved from the trusted task pack registry at this immutable revision. */
  readonly taskPack?: PromptPins['taskPack'] & { readonly bytes: Uint8Array };
};

type PromptInput = Pick<WakeContext, 'request' | 'event'>;

/** Assemble an attempt from trusted snapshots, keeping request and event data in the input. */
export const assembleBrainPrompt = async (
  job: BrainJob,
  { state, constitution, taskPack }: TrustedPromptInputs,
  { request, event }: PromptInput
): Promise<{ readonly systemPrompt: string; readonly input: PromptInput }> => {
  const pins = job.prompt;
  if (!constitution?.bytes?.byteLength)
    throw new Error('Pinned Brain constitution unavailable');

  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pins.constitution.repoHeadSha) ||
    constitution.repoHeadSha !== pins.constitution.repoHeadSha
  )
    throw new Error('Brain constitution commit does not match its pin');

  if (!taskPack?.bytes?.byteLength)
    throw new Error('Pinned Brain task pack unavailable');

  if (
    !pins.taskPack.id.trim() ||
    !pins.taskPack.revision.trim() ||
    taskPack.id !== pins.taskPack.id ||
    taskPack.revision !== pins.taskPack.revision
  )
    throw new Error(
      'Brain task pack identity or revision does not match its pin'
    );

  // Verify the same bytes that will be decoded, even if the caller reuses its buffer.
  const charterBytes = new Uint8Array(constitution.bytes);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const pack = decoder.decode(taskPack.bytes);
  const expectedDigest = pins.constitution.charterSha256;
  const digest = await crypto.subtle.digest('SHA-256', charterBytes);
  if (new Uint8Array(digest).toHex() !== expectedDigest)
    throw new Error('Brain constitution digest does not match its pin');

  const charter = decoder.decode(charterBytes);
  return {
    systemPrompt: systemPromptFor(state, [charter, pack].join('\n\n')),
    input: { request, event },
  };
};
