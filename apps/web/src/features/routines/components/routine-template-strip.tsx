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
import XIcon from '@icon/system/regular/x.svg';
import { Button, Card, cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { type RoutineTemplate, templateChain } from '../core/routine-templates';
import { RoutineSurface } from './routine-editor';

/** Each template's icon and tint, by what it is for. */
export function surfaceLook(surface: RoutineTemplate['surfaces'][number]) {
  return match(surface)
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

/** What a routine card shows. Templates and suggestions share it. */
export type RoutineCardContent = {
  surface: RoutineTemplate['surfaces'][number];
  title: string;
  /** What it does, in a line or two. */
  description: string;
  /** What starts it and what it does, for the line at the bottom. */
  chain: { trigger: string; action: string; actionAi: boolean };
  /** Said on hover and to screen readers, e.g. why AI suggested it. */
  hint?: string;
};

/** A template as a card. */
export function templateCard(template: RoutineTemplate): RoutineCardContent {
  return {
    surface: template.surfaces[0] ?? 'agents',
    title: template.title,
    description: template.description,
    chain: templateChain(template),
  };
}

/** What starts the card's routine and what it does, in a line. */
export function RoutineCardChain(props: { card: RoutineCardContent }) {
  const look = () => surfaceLook(props.card.surface);
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      <Dynamic
        component={look().icon}
        class="size-3 shrink-0 text-ink-extra-muted"
        aria-hidden="true"
      />
      <span class="truncate">{props.card.chain.trigger}</span>
      <ArrowRightIcon
        class="size-2.5 shrink-0 text-ink-placeholder"
        aria-hidden="true"
      />
      <Show when={props.card.chain.actionAi}>
        <SparkleIcon class="size-3 shrink-0 text-accent" aria-hidden="true" />
      </Show>
      <span class="truncate">{props.card.chain.action}</span>
    </span>
  );
}

/** What a card shows: what it is for, and what starts it and what it does. */
function CardButton(props: {
  card: RoutineCardContent;
  label: string;
  /** Said in place of the bottom line while the card's action runs. */
  status?: string;
  disabled?: boolean;
  onUse(): void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-description={props.card.hint}
      title={props.card.hint}
      disabled={props.disabled}
      class="flex size-full min-w-0 flex-col items-start gap-1.5 rounded-xl px-4 py-3.5 text-left outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus disabled:cursor-default"
      onClick={() => props.onUse()}
    >
      <Dynamic
        component={surfaceLook(props.card.surface).icon}
        class={cn('size-4 shrink-0', surfaceLook(props.card.surface).tint)}
        aria-hidden="true"
      />
      <span class="text-sm font-medium text-ink">{props.card.title}</span>
      <span class="line-clamp-2 text-xs leading-4 text-ink-muted">
        {props.card.description}
      </span>
      <span class="mt-1 min-w-0 max-w-full">
        <Show
          when={props.status}
          fallback={<RoutineCardChain card={props.card} />}
        >
          {(status) => (
            <span class="text-xs text-accent" aria-live="polite">
              {status()}
            </span>
          )}
        </Show>
      </span>
    </button>
  );
}

/**
 * A routine as a raised card. On a page it sits on the composer surface the
 * routine page uses; in a dialog it is one surface above the dialog's. With
 * `onDismiss` it has a close button in its corner.
 */
export function RoutineCard(props: {
  card: RoutineCardContent;
  /** The card's accessible name, which says what choosing it does. */
  label: string;
  on: 'page' | 'dialog';
  status?: string;
  disabled?: boolean;
  onUse(): void;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const content = () => (
    <div class="group/routine-card relative size-full min-w-0">
      <CardButton
        card={props.card}
        label={props.label}
        status={props.status}
        disabled={props.disabled}
        onUse={props.onUse}
      />
      <Show when={props.onDismiss}>
        {(dismiss) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.dismissLabel}
            title={props.dismissLabel}
            class="absolute top-2 right-2 not-touch:opacity-0 not-touch:group-hover/routine-card:opacity-100 not-touch:focus-visible:opacity-100"
            onClick={() => dismiss()()}
          >
            <XIcon class="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </Show>
    </div>
  );
  return (
    <Show
      when={props.on === 'page'}
      fallback={
        <Card variant="filled" depth={3} class="min-w-0">
          {content()}
        </Card>
      }
    >
      <RoutineSurface>{content()}</RoutineSurface>
    </Show>
  );
}

/** A template as a raised card. */
export function StarterTemplateCard(props: {
  template: RoutineTemplate;
  onUse(): void;
  on: 'page' | 'dialog';
}) {
  return (
    <RoutineCard
      on={props.on}
      card={templateCard(props.template)}
      label={`Start a routine from ${props.template.title}`}
      onUse={props.onUse}
    />
  );
}

/**
 * One row of routine cards above the routines list, with a heading and a
 * button to see them all. A phone scrolls the cards sideways.
 */
export function RoutineCardStrip(props: {
  heading: string;
  allLabel: string;
  onAll(): void;
  /** Hidden when there is nothing more to see. */
  showAll?: boolean;
  children: JSX.Element;
}) {
  return (
    <section
      aria-label={props.heading}
      class="grid min-w-0 gap-2.5 px-4 pb-2 pt-4 @max-[760px]/routines:px-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="text-sm font-semibold text-ink">{props.heading}</h2>
        <Show when={props.showAll ?? true}>
          <Button
            variant="ghost"
            size="sm"
            class="ml-auto"
            onClick={() => props.onAll()}
          >
            {props.allLabel}
          </Button>
        </Show>
      </div>
      {/* A phone scrolls the cards sideways instead of stacking them. */}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5 @max-[760px]/routines:-mx-3 @max-[760px]/routines:auto-cols-[15rem] @max-[760px]/routines:grid-flow-col @max-[760px]/routines:grid-cols-none @max-[760px]/routines:overflow-x-auto @max-[760px]/routines:px-3 @max-[760px]/routines:pb-1">
        {props.children}
      </div>
    </section>
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
    <RoutineCardStrip
      heading="Templates"
      allLabel="All templates"
      onAll={props.onAll}
    >
      <For each={props.templates}>
        {(template) => (
          <StarterTemplateCard
            on="page"
            template={template}
            onUse={() => props.onUse(template)}
          />
        )}
      </For>
    </RoutineCardStrip>
  );
}
