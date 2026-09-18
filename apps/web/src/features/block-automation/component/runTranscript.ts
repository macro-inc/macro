import type { RunTranscript } from '@service-scheduled-action/generated/schemas';
import { match, P } from 'ts-pattern';

/**
 * The one translation from the scheduler's vocabulary (`legacy_chat`,
 * `agent_session`) to the split layout's (`chat`, `agent`). Exhaustive, so a
 * new transcript kind on the backend fails this file's type check, not a click.
 */
export function transcriptTarget(
  transcript: RunTranscript | null | undefined
): { type: 'chat' | 'agent'; id: string } | undefined {
  return match(transcript)
    .with({ kind: 'legacy_chat' }, (t) => ({ type: 'chat' as const, id: t.id }))
    .with({ kind: 'agent_session' }, (t) => ({
      type: 'agent' as const,
      id: t.id,
    }))
    .with(P.nullish, () => undefined)
    .exhaustive();
}
