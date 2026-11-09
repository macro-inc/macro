import { t } from '@app/lib/i18n';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card, cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { RoutineSurface } from '../../routines/components/routine-editor';
import {
  type SentenceSize,
  StepSentence,
} from '../../routines/components/routine-step-knobs';
import {
  RoutineChain,
  surfaceLook,
} from '../../routines/components/routine-template-strip';
import type { Knob } from '../../routines/core/knobs';
import type {
  SuggestionAction,
  SuggestionChain,
  SuggestionStatus,
} from '../core/suggestions';
import type { RoutineSurface as AppSurface } from '../core/surfaces';

/** What a suggestion card shows, whichever layout it takes. */
export type SuggestionCardModel = {
  title: string;
  /** The part of the app whose icon and tint it shows. */
  look: AppSurface;
  /** The part of the app whose icon its trigger shows. */
  surface: AppSurface;
  chain: SuggestionChain;
  /** The knob sentence, else the summary in words. */
  sentence?: { sentence: string; knobs: Knob[] };
  summary: string;
  action: SuggestionAction;
  status: SuggestionStatus;
  /** Picked for the person by AI. */
  picked: boolean;
  /** A drafted routine, reviewed before it's saved. */
  drafted: boolean;
  /** One of Macro's templates. */
  template: boolean;
  /** Why AI picked it. */
  reason?: string;
};

type CardHandlers = {
  onAction(): void;
  onKnob(name: string, value: Knob['value']): void;
};

/** A suggestion's icon in its tint, with AI's violet sparkle on its corner when picked. */
export function SuggestionGlyph(props: { look: AppSurface; picked: boolean }) {
  const look = () => surfaceLook(props.look);
  return (
    <span class="relative flex shrink-0" aria-hidden="true">
      <Dynamic component={look().icon} class={cn('size-4', look().tint)} />
      <Show when={props.picked}>
        <span class="absolute -right-[5px] -bottom-1 flex size-[11px] items-center justify-center rounded-full bg-violet text-accent-contrast ring-2 ring-composer">
          <SparkleIcon class="size-[7px]" stroke-width="3" />
        </span>
      </Show>
    </span>
  );
}

/** The card's one action, or once it's on, that it is. */
function ActionButton(props: {
  model: SuggestionCardModel;
  /** A ghost Use, where cards are many (Discover). */
  quietUse?: boolean;
  onAction(): void;
}) {
  return (
    <Switch>
      <Match when={props.model.status.kind === 'enabled'}>
        <Badge variant="success" size="xs">
          <CheckIcon class="size-3" aria-hidden="true" />
          {t('routineSuggestions.on')}
        </Badge>
      </Match>
      <Match when={props.model.action === 'turn-on'}>
        <Button
          variant="primary"
          size="xs"
          disabled={props.model.status.kind === 'enabling'}
          aria-label={t('routineSuggestions.turnOnName', {
            name: props.model.title,
          })}
          onClick={() => props.onAction()}
        >
          {props.model.status.kind === 'enabling'
            ? t('routineSuggestions.turningOn')
            : t('routineSuggestions.turnOn')}
        </Button>
      </Match>
      <Match when={props.model.action === 'review'}>
        <Button
          variant="secondary"
          size="xs"
          aria-label={t('routineSuggestions.reviewName', {
            name: props.model.title,
          })}
          onClick={() => props.onAction()}
        >
          {t('routineSuggestions.review')}
        </Button>
      </Match>
      <Match when={props.model.action === 'use'}>
        <Button
          variant={props.quietUse ? 'ghost' : 'secondary'}
          size="xs"
          aria-label={t('routineSuggestions.useName', {
            name: props.model.title,
          })}
          onClick={() => props.onAction()}
        >
          {t('routineSuggestions.use')}
        </Button>
      </Match>
    </Switch>
  );
}

/** What it does: the knob sentence, editable in place, else its summary. */
function SuggestionText(props: {
  model: SuggestionCardModel;
  size: SentenceSize;
  /** Placement only, e.g. a fixed height. */
  class?: string;
  onKnob: CardHandlers['onKnob'];
}) {
  return (
    <Show
      when={props.model.sentence}
      fallback={
        <p
          class={cn(
            'text-ink-muted',
            props.size === 'sm'
              ? 'text-[13px] leading-[22px]'
              : 'text-xs leading-[19px]',
            props.class
          )}
        >
          {props.model.summary}
        </p>
      }
    >
      {(sentence) => (
        <StepSentence
          sentence={sentence().sentence}
          knobs={sentence().knobs}
          size={props.size}
          class={props.class}
          onKnob={props.onKnob}
        />
      )}
    </Show>
  );
}

function Failure(props: { status: SuggestionStatus }) {
  return (
    <Show when={props.status.kind === 'failed' && props.status}>
      {(failed) => (
        <p role="alert" class="text-xs text-failure">
          {failed().message}
        </p>
      )}
    </Show>
  );
}

/** A dialog card: badges, the knob sentence, and why AI picked it beside its action. */
export function SuggestionDialogCard(
  props: CardHandlers & {
    model: SuggestionCardModel;
    /** Not interested; absent where it can't be dismissed. */
    onDismiss?: () => void;
    onOpenRoutine(routineId: string): void;
  }
) {
  return (
    <li class="group/suggestion list-none">
      <Card
        variant="filled"
        depth={3}
        class="flex h-full min-w-0 flex-col gap-1.5 p-4"
      >
        <div class="flex min-w-0 items-center gap-2">
          <Dynamic
            component={surfaceLook(props.model.look).icon}
            class={cn('size-4 shrink-0', surfaceLook(props.model.look).tint)}
            aria-hidden="true"
          />
          <span class="flex-1" />
          <Show when={props.model.drafted}>
            <Badge variant="secondary" size="xs">
              {t('routineSuggestions.draft')}
            </Badge>
          </Show>
          <Show when={props.model.picked}>
            <Badge variant="violet" size="xs">
              <SparkleIcon class="size-2.5" aria-hidden="true" />
              {t('routineSuggestions.forYou')}
            </Badge>
          </Show>
          <Show when={!props.model.picked}>
            <Badge variant="secondary" size="xs">
              {t('routineSuggestions.template')}
            </Badge>
          </Show>
          <Show
            when={
              props.onDismiss &&
              props.model.status.kind !== 'enabling' &&
              props.model.status.kind !== 'enabled' &&
              props.onDismiss
            }
          >
            {(dismiss) => (
              <Button
                variant="ghost"
                size="icon-xs"
                class="-my-1 -mr-1 opacity-0 group-hover/suggestion:opacity-100 focus-visible:opacity-100"
                aria-label={t('routineSuggestions.notInterestedIn', {
                  name: props.model.title,
                })}
                tooltip={t('routineSuggestions.notInterested')}
                onClick={() => dismiss()()}
              >
                <XIcon class="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </Show>
        </div>
        <h3 class="mt-0.5 text-sm font-medium text-ink">{props.model.title}</h3>
        <SuggestionText
          model={props.model}
          size="sm"
          class="min-h-11"
          onKnob={props.onKnob}
        />
        <RoutineChain surface={props.model.surface} {...props.model.chain} />
        <Failure status={props.model.status} />
        <div class="mt-auto flex min-w-0 items-center gap-2 border-t border-edge-divider pt-3">
          <span class="min-w-0 flex-1 truncate text-xs text-ink-extra-muted">
            {props.model.reason ??
              (props.model.picked ? '' : t('routineSuggestions.fromMacro'))}
          </span>
          <Show
            when={props.model.status.kind === 'enabled' && props.model.status}
            fallback={
              <ActionButton model={props.model} onAction={props.onAction} />
            }
          >
            {(enabled) => (
              <Button
                variant="success"
                size="xs"
                onClick={() => props.onOpenRoutine(enabled().routineId)}
              >
                <CheckIcon class="size-3" aria-hidden="true" />
                {t('routineSuggestions.enabled')}
              </Button>
            )}
          </Show>
        </div>
      </Card>
    </li>
  );
}

/** A Discover card: title, two lines of sentence, and the chain beside its action. */
export function SuggestionDiscoverCard(
  props: CardHandlers & { model: SuggestionCardModel }
) {
  return (
    <li class="min-w-0 list-none">
      <RoutineSurface class="flex h-full flex-col gap-1.5 pt-3 pr-3 pb-2.5 pl-3.5">
        <div class="flex h-[22px] min-w-0 items-center gap-2">
          <SuggestionGlyph
            look={props.model.look}
            picked={props.model.picked}
          />
          <h3 class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {props.model.title}
          </h3>
        </div>
        <SuggestionText
          model={props.model}
          size="xs"
          class="line-clamp-2 h-[38px]"
          onKnob={props.onKnob}
        />
        <Failure status={props.model.status} />
        <div class="mt-auto flex min-h-6 min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1">
            <RoutineChain
              surface={props.model.surface}
              {...props.model.chain}
              triggerIcon={false}
            />
          </span>
          <ActionButton
            model={props.model}
            quietUse
            onAction={props.onAction}
          />
        </div>
      </RoutineSurface>
    </li>
  );
}

/** A compact card for the one row above the routines list. */
export function SuggestionCompactCard(
  props: Pick<CardHandlers, 'onAction'> & { model: SuggestionCardModel }
) {
  return (
    <li class="min-w-0 list-none">
      <RoutineSurface class="flex h-full items-center gap-3 py-2.5 pr-2.5 pl-3.5">
        <SuggestionGlyph look={props.model.look} picked={props.model.picked} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 class="truncate text-sm font-medium text-ink">
            {props.model.title}
          </h3>
          <RoutineChain
            surface={props.model.surface}
            {...props.model.chain}
            triggerIcon={false}
          />
        </div>
        <ActionButton model={props.model} onAction={props.onAction} />
      </RoutineSurface>
    </li>
  );
}

/** The last cell of the row: how many more there are, opening Discover. */
export function SuggestionMoreCell(props: {
  count: number;
  onOpen(): void;
}): JSX.Element {
  return (
    <li class="min-w-0 list-none">
      <button
        type="button"
        aria-label={t('routineSuggestions.moreInDiscover', {
          count: props.count,
        })}
        class="flex size-full min-h-[58px] min-w-0 items-center gap-2 rounded-xl border border-dashed border-edge-frame px-3.5 text-left outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
        onClick={() => props.onOpen()}
      >
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-ink">
            {t('routineSuggestions.more', { count: props.count })}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            {t('routineSuggestions.inDiscover')}
          </span>
        </span>
        <ArrowRightIcon
          class="size-3.5 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}
