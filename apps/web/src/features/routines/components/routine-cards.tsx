import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { RoutineRow } from '../core/types';
import { RoutineCard } from './routine-card';
import { RoutineRowMenu, type RoutineRowMenuActions } from './routine-row-menu';

/**
 * A section of the Routines page: a 14px icon, its title and count, and an
 * optional link at the end of the line.
 */
export function RoutineSectionHeader(props: {
  id: string;
  icon: Component<{ class?: string }>;
  title: string;
  count?: number;
  /** At the end of the line, e.g. "12 more in Discover". */
  end?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2 px-1">
      <Dynamic
        component={props.icon}
        aria-hidden="true"
        class="size-3.5 shrink-0 text-ink-muted"
      />
      <h2
        id={props.id}
        class="min-w-0 truncate text-[13px] font-semibold leading-5 text-ink"
      >
        {props.title}
      </h2>
      <Show when={props.count !== undefined}>
        <span class="text-[13px] leading-5 tabular-nums text-ink-placeholder">
          {props.count}
        </span>
      </Show>
      <span class="flex-1" />
      {props.end}
    </div>
  );
}

/**
 * The page's card grid: three equal columns, two and then one as the page
 * narrows. Suggestions and routines share it, so their cards line up.
 */
export function RoutineCardGrid(
  props: JSX.HTMLAttributes<HTMLUListElement> & {
    ref?: (el: HTMLUListElement) => void;
  }
) {
  return (
    <ul
      {...props}
      class="grid min-w-0 list-none grid-cols-3 gap-3 @max-[760px]/routines:grid-cols-2 @max-[480px]/routines:grid-cols-1"
    />
  );
}

type Group = {
  key: 'activity' | 'schedule';
  title: string;
  rows: RoutineRow[];
};

/** The routines as cards, by what starts them. */
export function RoutineCardSections(props: {
  groups: Group[];
  pendingId?: string;
  onOpen(id: string): void;
  onToggle(row: RoutineRow): void;
  menu?: RoutineRowMenuActions;
}) {
  return (
    // Keyed by group and routine: each list update makes new row objects,
    // and a card that remounted would close its open menu.
    <Key each={props.groups} by="key">
      {(group) => (
        <section
          aria-labelledby={`routines-${group().key}`}
          class="flex min-w-0 flex-col gap-3.5"
        >
          <RoutineSectionHeader
            id={`routines-${group().key}`}
            icon={group().key === 'activity' ? LightningIcon : ClockIcon}
            title={group().title}
            count={group().rows.length}
          />
          <RoutineCardGrid>
            <Key each={group().rows} by="id">
              {(row) => (
                <li class="min-w-0">
                  <RoutineRowMenu
                    row={row()}
                    pending={props.pendingId === row().id}
                    onToggle={props.onToggle}
                    actions={props.menu}
                  >
                    <RoutineCard
                      row={row()}
                      pending={props.pendingId === row().id}
                      onOpen={props.onOpen}
                      onToggle={props.onToggle}
                      menu={props.menu}
                      onStop={props.menu?.onStop}
                      stopPending={props.menu?.stopPending(row()) ?? false}
                    />
                  </RoutineRowMenu>
                </li>
              )}
            </Key>
          </RoutineCardGrid>
        </section>
      )}
    </Key>
  );
}

/** No routines yet: what shows up here, and where to start one. */
export function RoutinesEmpty(props: {
  /** Suggestions sit above; absent where they are off. */
  onOpenDiscover?: () => void;
  onCreate(): void;
}) {
  return (
    <div class="flex flex-col items-center gap-4 px-4 pt-18 text-center">
      <span
        aria-hidden="true"
        class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-active"
      >
        <RepeatIcon class="size-5 text-ink-muted" />
      </span>
      <div class="flex flex-col items-center gap-1">
        <h2 class="text-[17px] font-semibold leading-6 text-ink">
          {t('routinesList.emptyTitle')}
        </h2>
        <p class="max-w-100 text-sm leading-5 text-ink-muted">
          {props.onOpenDiscover
            ? t('routinesList.emptyBody')
            : t('routinesList.emptyBodyNoSuggestions')}
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
        <Button variant="primary" size="md" onClick={() => props.onCreate()}>
          {t('routinesList.newRoutine')}
        </Button>
        <Show when={props.onOpenDiscover}>
          {(open) => (
            <Button variant="secondary" size="md" onClick={() => open()()}>
              {t('routinesList.browseDiscover')}
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}
