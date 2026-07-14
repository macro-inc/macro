import { Match, Switch } from 'solid-js';
import { Entity } from '../../entity';
import type { AutomationEntity } from '../../types/entity';
import { formatDateAndTime } from '../../utils/timestamp';

function AutomationSubtitle(props: { entity: AutomationEntity }) {
  return (
    <div class="text-xs font-mono text-right uppercase font-light">
      <Switch>
        <Match when={props.entity.isRunning}>
          <span class="flex items-center justify-end gap-1.5 text-accent">
            <span class="size-1.5 animate-pulse rounded-full bg-accent" />
            Running
          </span>
        </Match>
        <Match when={props.entity.enabled && props.entity.nextRunAt}>
          {(nextRunAt) => (
            <span class="text-ink-extra-muted">
              Next run {formatDateAndTime(nextRunAt())}
            </span>
          )}
        </Match>
        <Match when={!props.entity.enabled}>
          <span class="text-ink-extra-muted">Paused</span>
        </Match>
      </Switch>
    </div>
  );
}

export function AutomationWideContent(props: { entity: AutomationEntity }) {
  return (
    <>
      <span class="w-(--title-width) shrink-0 truncate">
        <Entity.Title entity={props.entity} />
      </span>
      <span class="">
        <AutomationSubtitle entity={props.entity} />
      </span>
    </>
  );
}
