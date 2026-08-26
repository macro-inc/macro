import {
  describeSchedule,
  getDefaultTimezone,
  parseCron,
} from '@app/features/block-automation/component/automationUtils';
import {
  Entity,
  ListEntity,
  MultiSelectCheckbox,
  type AutomationEntity,
} from '@entity';
import { formatDateAndTime } from '@entity/utils/timestamp';
import { useExperimentalPowersDetails } from './experimental-powers-details-context';
import { cn, HoverCard } from '@ui';
import { formatDistanceToNowStrict } from 'date-fns';
import { type ComponentProps, Show } from 'solid-js';

type ExperimentalAutomationCardProps = Omit<
  ComponentProps<typeof ListEntity>,
  'entity'
> & {
  entity: AutomationEntity;
};

function TickingClockIcon(props: { animate: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path
        d="M8 8V4"
        class={
          props.animate
            ? 'group-hover:animate-[spin_12s_steps(12,end)_infinite] motion-reduce:group-hover:animate-none'
            : undefined
        }
        style={{ 'transform-origin': '8px 8px', 'transform-box': 'view-box' }}
      />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AutomationStatus(props: { entity: AutomationEntity }) {
  return (
    <span
      class={cn(
        'relative z-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold',
        props.entity.isRunning
          ? 'bg-accent/10 text-accent'
          : props.entity.enabled
            ? 'bg-success/10 text-success'
            : 'bg-ink/7 text-ink-muted'
      )}
    >
      <span
        class={cn(
          'size-1.5 rounded-full',
          props.entity.isRunning
            ? 'animate-pulse bg-accent'
            : props.entity.enabled
              ? 'bg-success'
              : 'bg-ink-extra-muted'
        )}
      />
      {props.entity.isRunning
        ? 'Running'
        : props.entity.enabled
          ? 'Active'
          : 'Paused'}
    </span>
  );
}

/** Portrait card presentation used exclusively by the Automations grid. */
export function ExperimentalAutomationCard(
  props: ExperimentalAutomationCardProps
) {
  const powersDetails = useExperimentalPowersDetails();
  const selected = () => {
    const detail = powersDetails?.detail();
    return detail?.kind === 'entity' && detail.entity.id === props.entity.id;
  };
  const scheduleDescription = () => {
    const localTimezone = getDefaultTimezone();
    const automationTimezone = props.entity.timezone;
    const description = describeSchedule(
      parseCron(props.entity.cron),
      automationTimezone && automationTimezone !== localTimezone
        ? automationTimezone
        : undefined
    );
    return description.charAt(0).toUpperCase() + description.slice(1);
  };

  return (
    <Entity.Root
      entity={props.entity}
      ref={props.ref}
      class={cn(
        'group relative flex min-h-60 min-w-0 cursor-default flex-col overflow-hidden rounded-2xl border border-edge-muted bg-lift p-4 text-left',
        'transition-shadow hover:shadow-sm',
        props.checked && 'bg-list-selected',
        selected() && 'bg-active'
      )}
      onClick={(event) => {
        if (event.metaKey && props.onChecked) {
          props.onChecked(!props.checked, event.shiftKey);
          return;
        }
        if (powersDetails && !event.shiftKey) {
          powersDetails.select({ kind: 'entity', entity: props.entity });
          return;
        }
        props.onClick?.(event);
      }}
      onMouseMove={props.onMouseMove}
    >
      <div class="relative z-1 flex items-center justify-between gap-4">
        <Show when={!props.hideCheckbox}>
          <div class="size-6">
            <MultiSelectCheckbox
              checked={props.checked}
              showBorder
              onChecked={props.onChecked}
            />
          </div>
        </Show>
        <div class="ml-auto">
          <AutomationStatus entity={props.entity} />
        </div>
      </div>

      <div class="relative z-1 mt-5 line-clamp-3 min-w-0 text-lg font-semibold leading-snug text-ink">
        <Entity.Title entity={props.entity} />
      </div>

      <Show when={props.entity.prompt}>
        {(prompt) => (
          <p class="relative z-1 mt-3 line-clamp-4 text-sm leading-relaxed text-ink-muted">
            {prompt()}
          </p>
        )}
      </Show>

      <Show when={props.entity.nextRunAt}>
        {(nextRunAt) => (
          <div class="relative z-1 mt-auto flex items-center gap-2 pt-5 text-xs text-ink-muted">
            <TickingClockIcon
              animate={props.entity.enabled && !props.entity.isRunning}
            />
            <HoverCard
              as="span"
              triggerClass="group/next-run cursor-help"
              contentClass="p-3"
              placement="bottom-start"
              content={
                <div class="grid min-w-56 gap-3 text-left">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted">
                      Schedule
                    </div>
                    <div class="mt-1 font-medium text-ink">
                      {scheduleDescription()}
                    </div>
                  </div>
                  <div class="border-t border-edge-muted pt-3">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted">
                      Next run
                    </div>
                    <div class="mt-1 font-medium text-ink">
                      {formatDateAndTime(nextRunAt())}
                    </div>
                  </div>
                </div>
              }
            >
              <span class="border-b border-dotted border-transparent group-hover/next-run:border-ink-muted/60">
                {formatDistanceToNowStrict(new Date(nextRunAt()))}
              </span>
            </HoverCard>
          </div>
        )}
      </Show>
    </Entity.Root>
  );
}
