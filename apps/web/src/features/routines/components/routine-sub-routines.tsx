import { t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { RoutineSurface } from './routine-editor';

/** A routine one of this routine's runs created, as its page lists it. */
export type SubRoutineItem = {
  id: string;
  name: string;
  /** What starts it, in a line. */
  when: string;
  state: 'active' | 'paused' | 'running' | 'finished';
};

function stateLabel(state: SubRoutineItem['state']): string {
  return match(state)
    .with('active', () => t('subRoutines.activeRow'))
    .with('paused', () => t('subRoutines.pausedRow'))
    .with('running', () => t('subRoutines.runningRow'))
    .with('finished', () => t('subRoutines.finishedRow'))
    .exhaustive();
}

function SubRoutineRow(props: {
  item: SubRoutineItem;
  onOpen(id: string): void;
}) {
  const open = () => props.onOpen(props.item.id);
  return (
    <li class="border-t border-edge-divider first:border-t-0">
      <button
        type="button"
        class="flex min-h-12 w-full min-w-0 items-center gap-3 px-6 py-2.5 text-left outline-none hover:bg-list-hover focus-visible:bg-list-highlighted @max-[600px]/routine:px-4"
        onClick={open}
      >
        <span class="flex min-w-0 flex-1 flex-col">
          <span
            class={cn(
              'truncate text-sm font-medium text-ink',
              props.item.state !== 'active' &&
                props.item.state !== 'running' &&
                'text-ink-muted'
            )}
          >
            {props.item.name}
          </span>
          <span class="truncate text-[13px] text-ink-muted">
            {props.item.when}
          </span>
        </span>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          {stateLabel(props.item.state)}
        </span>
        <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </button>
    </li>
  );
}

/**
 * The routines this routine's runs created: the ones with work left, and
 * behind "Finished: N" the one-time ones that have run, each opening its
 * page and run history.
 */
export function RoutineSubRoutines(props: {
  active: SubRoutineItem[];
  finished: SubRoutineItem[];
  onOpen(id: string): void;
}) {
  const [showFinished, setShowFinished] = createSignal(false);
  return (
    <RoutineSurface>
      <Show
        when={props.active.length > 0}
        fallback={
          <p class="px-6 py-4 text-sm text-ink-muted @max-[600px]/routine:px-4">
            {t('subRoutines.none')}
          </p>
        }
      >
        <ul aria-label={t('subRoutines.sectionTitle')}>
          <For each={props.active}>
            {(item) => <SubRoutineRow item={item} onOpen={props.onOpen} />}
          </For>
        </ul>
      </Show>
      <Show when={props.finished.length > 0}>
        <div class="flex items-center gap-2 border-t border-edge-divider px-6 py-2 @max-[600px]/routine:px-4">
          <span class="text-sm text-ink-muted">
            {t('subRoutines.finished', {
              count: props.finished.length,
            })}
          </span>
          <Button
            variant="ghost"
            size="xs"
            class="ml-auto"
            aria-expanded={showFinished()}
            onClick={() => setShowFinished((shown) => !shown)}
          >
            {showFinished()
              ? t('subRoutines.hideFinished')
              : t('subRoutines.showFinished')}
          </Button>
        </div>
        <Show when={showFinished()}>
          <ul aria-label={t('subRoutines.finishedRow')}>
            <For each={props.finished}>
              {(item) => <SubRoutineRow item={item} onOpen={props.onOpen} />}
            </For>
          </ul>
        </Show>
      </Show>
    </RoutineSurface>
  );
}
