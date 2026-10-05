import { match } from 'ts-pattern';
import { Entity } from '../../entity';
import type { RoutineEntity, RoutineStatus } from '../../types/entity';
import { formatDateAndTime } from '../../utils/timestamp';

function RoutineSubtitle(props: { status: RoutineStatus }) {
  return (
    <div class="text-xs font-mono text-right uppercase font-light">
      {match(props.status)
        .with({ kind: 'running' }, () => (
          <span class="flex items-center justify-end gap-1.5 text-accent">
            <span class="size-1.5 animate-pulse rounded-full bg-accent" />
            Running
          </span>
        ))
        .with({ kind: 'scheduled' }, ({ nextRunAt }) => (
          <span class="text-ink-extra-muted">
            Next run {formatDateAndTime(nextRunAt)}
          </span>
        ))
        .with({ kind: 'paused' }, () => (
          <span class="text-ink-extra-muted">Paused</span>
        ))
        .with({ kind: 'unscheduled' }, () => undefined)
        .exhaustive()}
    </div>
  );
}

export function RoutineWideContent(props: { entity: RoutineEntity }) {
  return (
    <>
      <span
        class="w-(--title-width) shrink-0 truncate"
        classList={{ 'text-ink-muted': props.entity.status.kind === 'paused' }}
      >
        <Entity.Title entity={props.entity} />
      </span>
      <span class="">
        <RoutineSubtitle status={props.entity.status} />
      </span>
    </>
  );
}
