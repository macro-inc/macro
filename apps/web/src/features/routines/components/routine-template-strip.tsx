import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope-simple.svg';
import FileIcon from '@icon/system/regular/file.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, Card, cn } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { type RoutineTemplate, templateChain } from '../core/routine-templates';
import { RoutineSurface } from './routine-editor';

/** Each template's icon and tint, by the part of the app it belongs to most. */
function templateLook(surfaces: RoutineTemplate['surfaces']) {
  return match(surfaces[0] ?? 'agents')
    .with('email', () => ({ icon: EnvelopeIcon, tint: 'text-blue' }))
    .with('tasks', () => ({ icon: CheckSquareIcon, tint: 'text-green' }))
    .with('calendar', () => ({ icon: ClockIcon, tint: 'text-orange' }))
    .with('files', () => ({ icon: FileIcon, tint: 'text-cyan' }))
    .with('crm', () => ({ icon: BuildingsIcon, tint: 'text-yellow' }))
    .with('chat', () => ({ icon: PaperPlaneIcon, tint: 'text-purple' }))
    .with('calls', () => ({ icon: PhoneIcon, tint: 'text-red' }))
    .with('reviews', () => ({ icon: GitPullRequestIcon, tint: 'text-pink' }))
    .with('agents', () => ({ icon: SparkleIcon, tint: 'text-accent' }))
    .exhaustive();
}

/** What starts the template's routine and what it does, in a line. */
function TemplateChain(props: { template: RoutineTemplate }) {
  const look = () => templateLook(props.template.surfaces);
  const chain = () => templateChain(props.template);
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      <Dynamic
        component={look().icon}
        class="size-3 shrink-0 text-ink-extra-muted"
        aria-hidden="true"
      />
      <span class="truncate">{chain().trigger}</span>
      <ArrowRightIcon
        class="size-2.5 shrink-0 text-ink-placeholder"
        aria-hidden="true"
      />
      <Show when={chain().actionAi}>
        <SparkleIcon class="size-3 shrink-0 text-accent" aria-hidden="true" />
      </Show>
      <span class="truncate">{chain().action}</span>
    </span>
  );
}

/** What a template card shows: what it is for, and what starts it and what it does. */
function TemplateCardButton(props: {
  template: RoutineTemplate;
  onUse(): void;
}) {
  return (
    <button
      type="button"
      aria-label={`Start a routine from ${props.template.title}`}
      class="flex size-full min-w-0 flex-col items-start gap-1.5 rounded-xl px-4 py-3.5 text-left outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
      onClick={() => props.onUse()}
    >
      <Dynamic
        component={templateLook(props.template.surfaces).icon}
        class={cn(
          'size-4 shrink-0',
          templateLook(props.template.surfaces).tint
        )}
        aria-hidden="true"
      />
      <span class="text-sm font-medium text-ink">{props.template.title}</span>
      <span class="line-clamp-2 text-xs leading-4 text-ink-muted">
        {props.template.description}
      </span>
      <span class="mt-1 min-w-0 max-w-full">
        <TemplateChain template={props.template} />
      </span>
    </button>
  );
}

/**
 * A template as a raised card. On a page it sits on the composer surface the
 * routine page uses; in a dialog it is one surface above the dialog's.
 */
export function StarterTemplateCard(props: {
  template: RoutineTemplate;
  onUse(): void;
  on: 'page' | 'dialog';
}) {
  return (
    <Show
      when={props.on === 'page'}
      fallback={
        <Card variant="filled" depth={3} class="min-w-0">
          <TemplateCardButton template={props.template} onUse={props.onUse} />
        </Card>
      }
    >
      <RoutineSurface>
        <TemplateCardButton template={props.template} onUse={props.onUse} />
      </RoutineSurface>
    </Show>
  );
}

/**
 * Macro's routine templates above the list, as raised cards. Choosing one
 * opens New routine already started from it, ready to review.
 */
export function RoutineTemplateStrip(props: {
  templates: RoutineTemplate[];
  onUse(template: RoutineTemplate): void;
  onAll(): void;
}) {
  return (
    <section
      aria-label="Templates"
      class="grid min-w-0 gap-2.5 px-4 pb-2 pt-4 @max-[760px]/routines:px-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="text-sm font-semibold text-ink">Templates</h2>
        <Button
          variant="ghost"
          size="sm"
          class="ml-auto"
          onClick={() => props.onAll()}
        >
          All templates
        </Button>
      </div>
      {/* A phone scrolls the cards sideways instead of stacking them. */}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5 @max-[760px]/routines:-mx-3 @max-[760px]/routines:auto-cols-[15rem] @max-[760px]/routines:grid-flow-col @max-[760px]/routines:grid-cols-none @max-[760px]/routines:overflow-x-auto @max-[760px]/routines:px-3 @max-[760px]/routines:pb-1">
        <For each={props.templates}>
          {(template) => (
            <StarterTemplateCard
              on="page"
              template={template}
              onUse={() => props.onUse(template)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
