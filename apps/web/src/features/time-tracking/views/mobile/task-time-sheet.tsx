import { MobileDrawer } from '@app/components/app/mobile/MobileDrawer';
import {
  SwipableRow,
  SwipableRowProvider,
} from '@app/components/app/mobile/SwipableRow';
import { t } from '@app/lib/i18n';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { EntryForm } from '../../components/entry-form';
import { QuickLengths } from '../../components/log-time-input';
import { TimePill } from '../../components/time-pill';
import { TimerControl } from '../../components/timer-control';
import { useTimeTracking } from '../../context/time-tracking-context';
import { localDay } from '../../core/entry-days';
import { createTaskTime } from '../../primitives/create-task-time';
import { EntriesSection } from '../shared/entries-section';
import { reportWrite } from '../shared/report-write';
import type { TaskTimeViewProps } from '../shared/task-time-props';
import { createTimerActions } from '../shared/timer-actions';

type Mode =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; entry: TimeEntryFieldsFragment };

/**
 * The Time pill and its bottom sheet, on touch devices. Given `open`, the
 * sheet opens for whoever holds it (My week's Log time) and the pill stays
 * out.
 */
export function TaskTimeSheet(
  props: TaskTimeViewProps & {
    open?: boolean;
    onOpenChange?(open: boolean): void;
  }
): JSX.Element {
  const [ownOpen, setOwnOpen] = createSignal(false);
  const controlled = () => props.open !== undefined;
  const open = () => props.open ?? ownOpen();
  const setOpen = (next: boolean) => {
    if (props.onOpenChange) props.onOpenChange(next);
    else setOwnOpen(next);
  };
  const [mode, setMode] = createSignal<Mode>({ kind: 'list' });
  const [list, setList] = createSignal<HTMLElement>();
  // Entries load when the panel first opens; the pill reads the total from
  // the task.
  const [opened, setOpened] = createSignal(false);
  const time = createTaskTime(() =>
    opened() || (controlled() && open()) ? props.taskId : undefined
  );
  const today = () => localDay(new Date());
  const capabilities = useTimeTracking();
  const timer = capabilities.runningTimer;
  const timerActions = createTimerActions(capabilities);
  const timingThis = () => timer.timer()?.taskId === props.taskId;
  const own = (id: string) =>
    time.entries().find((entry) => entry.id === id && entry.canEdit);
  const editing = () => {
    const current = mode();
    return current.kind === 'edit' ? current.entry : undefined;
  };

  return (
    <>
      <Show when={!controlled()}>
        <TimePill
          minutes={props.minutes}
          aria-expanded={open()}
          class="min-h-9"
          onClick={() => {
            setMode({ kind: 'list' });
            setOpened(true);
            setOpen(true);
          }}
        />
      </Show>
      <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content maxHeight={90}>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-4 pb-2 text-base font-medium text-ink">
              {t('timeTracking.popoverTitle')}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody class="flex flex-col gap-2 px-2 pb-4">
              <Switch>
                <Match when={editing()}>
                  {(entry) => (
                    <EntryForm
                      initial={entry()}
                      submitLabel={t('timeTracking.save')}
                      onCancel={() => setMode({ kind: 'list' })}
                      onSubmit={(values) => {
                        const edited = entry();
                        setMode({ kind: 'list' });
                        reportWrite(
                          time.update(edited, values),
                          t('timeTracking.saveFailed')
                        );
                      }}
                      onDelete={() => {
                        const deleted = entry();
                        setMode({ kind: 'list' });
                        reportWrite(
                          time.remove(deleted),
                          t('timeTracking.deleteFailed')
                        );
                      }}
                    />
                  )}
                </Match>
                <Match when={mode().kind === 'new'}>
                  <EntryForm
                    initial={{ date: today() }}
                    submitLabel={t('timeTracking.logTime')}
                    onCancel={() => setMode({ kind: 'list' })}
                    onSubmit={(values) => {
                      setMode({ kind: 'list' });
                      reportWrite(
                        time.log(values),
                        t('timeTracking.saveFailed')
                      );
                    }}
                  />
                </Match>
                <Match when={mode().kind === 'list'}>
                  <Show when={props.canEdit}>
                    <TimerControl
                      variant="block"
                      running={timingThis()}
                      seconds={timer.seconds()}
                      disabled={timer.busy() || timer.offline()}
                      disabledReason={
                        timer.offline()
                          ? t('timeTracking.timerOffline')
                          : undefined
                      }
                      onStart={() => timerActions.start(props.taskId)}
                      onStop={timerActions.stop}
                    />
                    <QuickLengths
                      chips
                      onLog={(minutes) =>
                        reportWrite(
                          time.log({
                            date: today(),
                            minutes,
                            note: null,
                            startedAt: null,
                            endedAt: null,
                          }),
                          t('timeTracking.saveFailed')
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setMode({ kind: 'new' })}
                      class="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm text-ink"
                    >
                      <span>{t('timeTracking.customEntry')}</span>
                      <span class="text-xs text-ink-muted">
                        {t('timeTracking.customEntryHint')}
                      </span>
                    </button>
                  </Show>
                  <SwipableRowProvider
                    container={list}
                    canSwipeLeft={(id) => own(id) !== undefined}
                    canSwipeRight={(id) => own(id) !== undefined}
                    onSwipeLeft={(id) => {
                      const entry = own(id);
                      if (entry) {
                        reportWrite(
                          time.remove(entry),
                          t('timeTracking.deleteFailed')
                        );
                      }
                    }}
                    onSwipeRight={(id) => {
                      const entry = own(id);
                      if (entry) setMode({ kind: 'edit', entry });
                    }}
                  >
                    <div ref={setList} class="overflow-hidden">
                      <EntriesSection
                        time={time}
                        today={today()}
                        person={props.person}
                        row={(entry, content) => (
                          <Show when={entry.canEdit} fallback={content}>
                            <SwipableRow
                              id={entry.id}
                              swipeLeftColor="bg-failure"
                              swipeLeftRevealedComponent={
                                <TrashIcon
                                  class="size-6 text-surface"
                                  aria-label={t('timeTracking.deleteEntry')}
                                />
                              }
                              swipeRightColor="bg-accent"
                              swipeRightRevealedComponent={
                                <PencilIcon
                                  class="size-6 text-surface"
                                  aria-label={t('timeTracking.editEntry')}
                                />
                              }
                            >
                              <button
                                type="button"
                                class="w-full text-left"
                                aria-description={t('timeTracking.editEntry')}
                                onClick={() => setMode({ kind: 'edit', entry })}
                              >
                                {content}
                              </button>
                            </SwipableRow>
                          </Show>
                        )}
                      />
                    </div>
                  </SwipableRowProvider>
                </Match>
              </Switch>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </>
  );
}
