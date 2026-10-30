import CheckSquareIcon from '@phosphor/check-square.svg';
import EnvelopeIcon from '@phosphor/envelope-simple.svg';
import FlagIcon from '@phosphor/flag.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import PlusIcon from '@phosphor/plus.svg';
import SunIcon from '@phosphor/sun.svg';
import { cn } from '@ui';
import { type Component, For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { RoutineTemplate } from '../core/routine-templates';

const templateIcons: Record<
  RoutineTemplate['key'],
  Component<{ class?: string }>
> = {
  inbox: EnvelopeIcon,
  triage: CheckSquareIcon,
  brief: SunIcon,
  stuck: FlagIcon,
  updates: PaperPlaneIcon,
};

function StartCard(props: {
  title: string;
  description: string;
  icon: Component<{ class?: string }>;
  ai?: boolean;
  blank?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      class={cn(
        'flex min-w-0 flex-col items-start gap-2.5 rounded-xl border p-3.5 text-left hover:bg-hover',
        props.blank
          ? 'border-dashed border-edge'
          : 'border-edge-muted bg-surface'
      )}
      onClick={() => props.onSelect()}
    >
      <span
        class={cn(
          'flex size-7 items-center justify-center rounded-md',
          props.ai ? 'bg-accent-bg text-accent-ink' : 'bg-hover text-ink-muted'
        )}
      >
        <Dynamic component={props.icon} class="size-4" />
      </span>
      <span class="grid min-w-0 gap-0.5">
        <span class="text-sm font-medium text-ink">{props.title}</span>
        <span class="text-xs text-ink-muted">{props.description}</span>
      </span>
    </button>
  );
}

/**
 * Where a new routine starts: describe it for AI to draft, or pick a
 * starting point. Either way the editor opens with something to review.
 */
export function RoutineStart(props: {
  /** The description box; absent where AI drafting is unavailable. */
  describe?: JSX.Element;
  templates: RoutineTemplate[];
  onTemplate(template: RoutineTemplate): void;
  onBlank(): void;
}) {
  return (
    <div class="grid min-w-0 gap-5 pb-4">
      <h2 class="text-xl font-semibold text-ink">
        What should this routine do?
      </h2>
      {props.describe}
      <section aria-label="Start from" class="grid min-w-0 gap-2.5">
        <span class="text-xs text-ink-extra-muted">
          {props.describe ? 'Or start from' : 'Start from'}
        </span>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2.5">
          <For each={props.templates}>
            {(template) => (
              <StartCard
                title={template.title}
                description={template.description}
                icon={templateIcons[template.key]}
                ai={template.ai}
                onSelect={() => props.onTemplate(template)}
              />
            )}
          </For>
          <StartCard
            title="Start blank"
            description="Pick a trigger, add steps"
            icon={PlusIcon}
            blank
            onSelect={() => props.onBlank()}
          />
        </div>
      </section>
    </div>
  );
}
