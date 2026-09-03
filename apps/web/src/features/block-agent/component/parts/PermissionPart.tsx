/**
 * A permission request. While it is open the agent's options are offered as
 * buttons; once resolved, the outcome is the trailing text.
 *
 * Correlation needs no bookkeeping here: an answer is a control POST, and the
 * fold flips this part's `outcome` off `pending` when the response is logged.
 * Outside a session block (the gallery) there is nothing to answer through,
 * so an open request renders inert.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { useOptionalAgentSession } from '../../context/AgentSessionContext';
import { PermissionOptions, ToolCard } from '../../ui';

export function PermissionPart(props: {
  part: Extract<MessagePart, { kind: 'permission' }>;
}) {
  const session = useOptionalAgentSession();
  const pending = () => props.part.outcome.kind === 'pending';
  // Only a live session can still take an answer: a request left open by a
  // runtime that is gone will never be resolved by clicking.
  const answerable = () =>
    pending() && session !== undefined && session.working();
  const answering = () =>
    session?.composer.answeringPermission(props.part.requestId) ?? false;

  const outcome = () => {
    const resolved = props.part.outcome;
    if (resolved.kind === 'pending') {
      return answerable() ? undefined : 'Waiting for an answer';
    }
    if (resolved.kind === 'cancelled') return 'Cancelled';
    if (resolved.kind === 'errored') return 'Failed';
    if (resolved.kind === 'unrecognized') return 'Answered';
    const chosen = props.part.options.find(
      (option) => option.id === resolved.optionId
    );
    return chosen?.name ?? 'Answered';
  };

  return (
    <ToolCard
      title={answerable() ? 'Permission needed' : 'Permission requested'}
      trailing={
        <Show when={outcome()}>
          {(label) => <span class="text-ink">{label()}</span>}
        </Show>
      }
      status={answerable() ? 'running' : 'completed'}
      // Held open while the options are live: a question nobody can see is
      // not being asked. Released once answered, so the card folds up like
      // any other resolved tool row.
      open={answerable() || undefined}
    >
      <Show when={answerable()}>
        <div class="py-1">
          <PermissionOptions
            options={props.part.options}
            disabled={answering()}
            onSelect={(optionId) =>
              session?.composer.respondToPermission(props.part.requestId, {
                kind: 'selected',
                optionId,
              })
            }
          />
        </div>
      </Show>
    </ToolCard>
  );
}
