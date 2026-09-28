/**
 * A control the user issued mid-session: model switch, compaction, stop.
 *
 * A rejection is half the message. A runtime that refuses a control answers
 * with a JSON-RPC error the fold records as `rejected` — most often a model
 * the harness advertised but cannot actually run — and that line has to say
 * so, carrying the runtime's own words. Everything short of a rejection
 * reads as done: the fold speculates the control, so naming a separate
 * in-progress state would only make the switch look slower than it is.
 */

import { modelLabel } from '@core/component/AI/constant/model-label';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { match, P } from 'ts-pattern';
import { ActionLine } from '../../ui';

type ControlPartData = Extract<MessagePart, { kind: 'control' }>;

/** What to call the control, in each of the three outcomes. */
function label(part: ControlPartData): string {
  return (
    match([part.control, part.outcome] as const)
      // A model switch reads as done the instant it is issued; only a
      // runtime refusal, after the fact, reads differently.
      .with(
        [{ kind: 'set_model' }, { kind: P.union('pending', 'accepted') }],
        ([control]) => `Model set to ${modelLabel(control.model)}`
      )
      .with(
        [{ kind: 'set_model' }, { kind: 'rejected' }],
        ([control]) => `Couldn't switch to ${modelLabel(control.model)}`
      )
      .with(
        [{ kind: 'compact' }, { kind: 'pending' }],
        () => 'Compacting context…'
      )
      .with(
        [{ kind: 'compact' }, { kind: 'accepted' }],
        () => 'Context compacted'
      )
      .with(
        [{ kind: 'compact' }, { kind: 'rejected' }],
        () => "Couldn't compact the context"
      )
      // A stop is acknowledged the moment it is issued — nothing answers it, so
      // it has no pending state worth naming and cannot be refused.
      .with(
        [{ kind: 'stop' }, { kind: 'rejected' }],
        () => "Couldn't stop the agent"
      )
      .with([{ kind: 'stop' }, { kind: 'pending' }], () => 'Stopped')
      .with([{ kind: 'stop' }, { kind: 'accepted' }], () => 'Stopped')
      .exhaustive()
  );
}

export function ControlPart(props: { part: ControlPartData }) {
  const rejection = () =>
    props.part.outcome.kind === 'rejected'
      ? props.part.outcome.message
      : undefined;

  return (
    <ActionLine
      label={label(props.part)}
      failed={rejection() !== undefined}
      detail={rejection()}
    />
  );
}
