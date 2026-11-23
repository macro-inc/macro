import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn, ToggleSwitch, Tooltip } from '@ui';
import { Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { surfaceLook } from '../../routines/components/routine-template-strip';
import { RoutineSurface } from '../../routines/components/routine-editor';
import { sentenceText } from '../../routines/core/knobs';
import type { SuggestionCardModel } from './suggestion-card';

/** The routine a card turned on, as the routines list has it. */
export type TurnedOnRoutine = {
  enabled: boolean;
  /** Its switch can't be used now (saving, or a run in progress). */
  locked: boolean;
};

/** What its one button says: what clicking it does. */
function actionLabel(model: SuggestionCardModel): string {
  if (model.status.kind === 'enabling')
    return t('routineSuggestions.turningOn');
  if (model.action === 'turn-on') return t('routineSuggestions.turnOn');
  if (model.action === 'review') return t('routineSuggestions.review');
  return t('routineSuggestions.use');
}

/**
 * A suggestion on the Routines page, shaped like a routine's card so the two
 * grids line up: its tile, title and what it does, and one line under them
 * with why it fits and Turn on. Once on, the same card shows the routine's
 * switch, what starts it, and Edit. Every state keeps the card's height.
 */
export function SuggestionCompactCard(props: {
  model: SuggestionCardModel;
  /** The whole card: opens the routine in the editor, or once on, the routine. */
  onOpen(): void;
  onTurnOn(): void;
  /** Not interested; absent where it can't be dismissed. */
  onDismiss?: () => void;
  /** The routine it turned on, once the routines list has it. */
  routine?: TurnedOnRoutine;
  /** Switch that routine on or off. */
  onToggle?: () => void;
}) {
  const look = () => surfaceLook(props.model.look);
  const enabled = () => props.model.status.kind === 'enabled';
  const on = () => props.routine?.enabled ?? enabled();
  const text = () => {
    const sentence = props.model.sentence;
    return (
      (sentence && sentenceText(sentence.sentence, sentence.knobs)) ||
      props.model.summary
    );
  };
  const failure = () =>
    props.model.status.kind === 'failed' ? props.model.status.message : '';
  return (
    <li class="group/card min-w-0 list-none">
      {/* Discover's card surface, so the two grids' cards match. */}
      <RoutineSurface class="flex h-full flex-col gap-3.5 p-4">
      <div class="flex min-w-0 flex-1 gap-3">
        <span
          aria-hidden="true"
          class={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg bg-current/15',
            look().tint
          )}
        >
          <Dynamic component={look().icon} class="size-4" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          {/* The title's hit area covers the card; the controls sit above it. */}
          <button
            type="button"
            aria-label={
              enabled()
                ? t('routineSuggestions.openName', { name: props.model.title })
                : undefined
            }
            class="min-w-0 truncate text-left text-sm font-medium leading-5 text-ink outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] not-touch:group-hover/card:after:bg-hover focus-visible:static focus-visible:after:ring-2 focus-visible:after:ring-edge-focus"
            onClick={() => props.onOpen()}
          >
            {props.model.title}
          </button>
          <p class="line-clamp-2 min-h-[38px] text-[13px] leading-[19px] text-ink-muted">
            {text()}
          </p>
        </div>
        <Switch>
          <Match when={enabled() && props.routine && props.onToggle}>
            {(toggle) => (
              <span class="relative z-[1] flex shrink-0 self-start">
                <Tooltip
                  label={
                    on() ? t('routinesList.turnOff') : t('routinesList.turnOn')
                  }
                >
                  <ToggleSwitch
                    label={t('routinesList.enabledFor', {
                      name: props.model.title,
                    })}
                    labelClass="sr-only"
                    checked={on()}
                    disabled={props.routine?.locked}
                    onChange={() => toggle()()}
                  />
                </Tooltip>
              </span>
            )}
          </Match>
          <Match
            when={
              props.model.status.kind !== 'enabling' &&
              !enabled() &&
              props.onDismiss
            }
          >
            {(dismiss) => (
              <Button
                variant="ghost"
                size="icon-xs"
                class="relative z-[1] -mt-0.5 -mr-1 self-start not-touch:opacity-0 not-touch:group-hover/card:opacity-100 not-touch:focus-visible:opacity-100"
                aria-label={t('routineSuggestions.notInterestedIn', {
                  name: props.model.title,
                })}
                tooltip={t('routineSuggestions.notInterested')}
                onClick={() => dismiss()()}
              >
                <XIcon class="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </Match>
        </Switch>
      </div>
      <div class="flex h-7 min-w-0 items-center gap-1.5 pl-11">
        <Switch
          fallback={
            <>
              <span
                class={cn(
                  'min-w-0 flex-1 truncate text-xs leading-4',
                  failure() ? 'text-failure' : 'text-ink-placeholder'
                )}
              >
                {failure() || props.model.reason}
              </span>
              <Button
                variant="secondary"
                size="sm"
                class="relative z-[1]"
                disabled={props.model.status.kind === 'enabling'}
                aria-label={
                  props.model.action === 'turn-on'
                    ? t('routineSuggestions.turnOnName', {
                        name: props.model.title,
                      })
                    : undefined
                }
                onClick={() =>
                  props.model.action === 'turn-on'
                    ? props.onTurnOn()
                    : props.onOpen()
                }
              >
                {actionLabel(props.model)}
              </Button>
            </>
          }
        >
          <Match when={enabled()}>
            <span
              aria-hidden="true"
              class={cn(
                'size-1.5 shrink-0 rounded-full',
                on() ? 'bg-success' : 'bg-ink-extra-muted'
              )}
            />
            <span class="min-w-0 flex-1 truncate text-xs leading-4 text-ink-placeholder">
              {t(
                on()
                  ? 'routineSuggestions.onWhen'
                  : 'routineSuggestions.offWhen',
                {
                  when: props.model.chain.trigger,
                }
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              class="relative z-[1]"
              aria-label={t('routineSuggestions.editRoutine', {
                name: props.model.title,
              })}
              onClick={() => props.onOpen()}
            >
              {t('routineSuggestions.edit')}
            </Button>
          </Match>
        </Switch>
      </div>
      </RoutineSurface>
    </li>
  );
}
