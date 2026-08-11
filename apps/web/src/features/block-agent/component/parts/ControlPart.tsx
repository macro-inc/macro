/** A control the user issued mid-session: model switch, compaction, stop. */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';
import { ToolCard } from '../../ui';

export function ControlPart(props: {
  part: Extract<MessagePart, { kind: 'control' }>;
}) {
  const label = () =>
    match(props.part.control)
      .with({ kind: 'set_model' }, (control) => `Model set to ${control.model}`)
      .with({ kind: 'compact' }, () => 'Context compacted')
      .with({ kind: 'stop' }, () => 'Stopped')
      .exhaustive();

  return <ToolCard title={label()} status="completed" />;
}
