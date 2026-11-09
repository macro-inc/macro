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
import { type Knob, sentenceText } from '../../routines/core/knobs';
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
  /** The whole card: opens the routine in the editor, or once on, the routine. */
  onOpen(): void;
  /** Turn on, for AI's catalog picks. */
  onTurnOn(): void;
  onKnob(name: string, value: Knob['value']): void;
};

/** What the card itself does when clicked, as its accessible name. */
function openLabel(model: SuggestionCardModel) {
  const name = model.title;
  if (model.status.kind === 'enabled')
    return t('routineSuggestions.openName', { name });
  if (model.action === 'review')
    return t('routineSuggestions.reviewName', { name });
  if (model.action === 'use') return t('routineSuggestions.useName', { name });
  return t('routineSuggestions.editName', { name });
}

/**
 * The card's title as a button whose hit area covers the whole card, with
 * the card's hover tint and focus ring. Controls on the card (values, Turn
 * on, Not interested) are positioned, so they sit above it. It stays
 * unpositioned when focused (the app positions every :focus-visible
 * element), or the ring would shrink to the title.
 */
function CardTarget(props: {
  model: SuggestionCardModel;
  class?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      aria-label={openLabel(props.model)}
      class={cn(
        "min-w-0 truncate text-left text-sm font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] not-touch:hover:after:bg-hover focus-visible:static focus-visible:after:ring-2 focus-visible:after:ring-edge-focus",
        props.class
      )}
      onClick={() => props.onOpen()}
    >
      {props.model.title}
    </button>
  );
}

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

/**
 * The card's one visible action: Turn on for AI's catalog picks; for a
 * drafted routine or a template, a quiet label for what clicking the card
 * does; once on, that it is.
 */
function CardAction(props: { model: SuggestionCardModel; onTurnOn(): void }) {
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
          class="relative"
          disabled={props.model.status.kind === 'enabling'}
          aria-label={t('routineSuggestions.turnOnName', {
            name: props.model.title,
          })}
          onClick={() => props.onTurnOn()}
        >
          {props.model.status.kind === 'enabling'
            ? t('routineSuggestions.turningOn')
            : t('routineSuggestions.turnOn')}
        </Button>
      </Match>
      <Match when={props.model.action !== 'turn-on'}>
        <span
          aria-hidden="true"
          class="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-muted not-touch:group-hover/card:text-ink"
        >
          {props.model.action === 'review'
            ? t('routineSuggestions.review')
            : t('routineSuggestions.use')}
          <ArrowRightIcon class="size-3" />
        </span>
      </Match>
    </Switch>
  );
}

/**
 * What it does: the knob sentence, editable in place until it is turned on,
 * else its summary.
 */
function SuggestionText(props: {
  model: SuggestionCardModel;
  size: SentenceSize;
  /** Placement only, e.g. a fixed height. */
  class?: string;
  onKnob: CardHandlers['onKnob'];
}) {
  // What was saved, or is being saved, no longer changes from the card.
  const locked = () =>
    props.model.status.kind === 'enabling' ||
    props.model.status.kind === 'enabled';
  const text = () => {
    const sentence = props.model.sentence;
    return (
      (sentence && sentenceText(sentence.sentence, sentence.knobs)) ||
      props.model.summary
    );
  };
  return (
    <Show
      when={!locked() && props.model.sentence}
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
          {text()}
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
  }
) {
  return (
    <li class="group/card list-none">
      <Card
        variant="filled"
        depth={3}
        class="relative flex h-full min-w-0 flex-col gap-1.5 p-4"
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
                class="relative z-[1] -my-1 -mr-1 not-touch:opacity-0 not-touch:group-hover/card:opacity-100 not-touch:focus-visible:opacity-100"
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
        <h3 class="mt-0.5 flex min-w-0">
          <CardTarget model={props.model} onOpen={props.onOpen} />
        </h3>
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
            when={props.model.status.kind === 'enabled'}
            fallback={
              <CardAction model={props.model} onTurnOn={props.onTurnOn} />
            }
          >
            <Button
              variant="success"
              size="xs"
              class="relative"
              onClick={() => props.onOpen()}
            >
              <CheckIcon class="size-3" aria-hidden="true" />
              {t('routineSuggestions.enabled')}
            </Button>
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
    <li class="group/card min-w-0 list-none">
      <RoutineSurface class="flex h-full flex-col gap-1.5 pt-3 pr-3 pb-2.5 pl-3.5">
        <div class="flex h-[22px] min-w-0 items-center gap-2">
          <SuggestionGlyph
            look={props.model.look}
            picked={props.model.picked}
          />
          <h3 class="flex min-w-0 flex-1">
            <CardTarget model={props.model} onOpen={props.onOpen} />
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
          <CardAction model={props.model} onTurnOn={props.onTurnOn} />
        </div>
      </RoutineSurface>
    </li>
  );
}

/** A compact card for the one row above the routines list. */
export function SuggestionCompactCard(
  props: Pick<CardHandlers, 'onOpen' | 'onTurnOn'> & {
    model: SuggestionCardModel;
  }
) {
  return (
    <li class="group/card min-w-0 list-none">
      <RoutineSurface class="flex h-full items-center gap-3 py-2.5 pr-2.5 pl-3.5">
        <SuggestionGlyph look={props.model.look} picked={props.model.picked} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 class="flex min-w-0">
            <CardTarget model={props.model} onOpen={props.onOpen} />
          </h3>
          <RoutineChain
            surface={props.model.surface}
            {...props.model.chain}
            triggerIcon={false}
          />
        </div>
        <CardAction model={props.model} onTurnOn={props.onTurnOn} />
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
