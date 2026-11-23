import { t } from '@app/lib/i18n';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import { Popover } from '@kobalte/core/popover';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { Dropdown } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { EntryForm } from '../components/entry-form';
import { LogTimeInput, QuickLengths } from '../components/log-time-input';
import { TimePill } from '../components/time-pill';
import { localDay } from '../core/entry-days';
import { createTaskTime } from '../primitives/create-task-time';
import type { TimeEntryValues } from '../queries/time-entries';
import { EntriesSection } from './shared/entries-section';
import { reportWrite } from './shared/report-write';
import type { TaskTimeViewProps } from './task-time-view';

type Mode =
  | { kind: 'list' }
  | { kind: 'new'; minutes?: number }
  | { kind: 'edit'; entry: TimeEntryFieldsFragment };

/** The Time pill and its popover, on desktop. */
export function TaskTimeDesktop(props: TaskTimeViewProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [mode, setMode] = createSignal<Mode>({ kind: 'list' });
  const time = createTaskTime(() => props.taskId);
  const today = () => localDay(new Date());
  let anchor: HTMLButtonElement | undefined;

  const log = (values: TimeEntryValues) =>
    reportWrite(time.log(values), t('timeTracking.saveFailed'));
  const logLength = (minutes: number, day: string) =>
    log({ date: day, minutes, note: null, startedAt: null, endedAt: null });

  const actions = (entry: TimeEntryFieldsFragment) => (
    <Show when={entry.canEdit}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          aria-label={t('timeTracking.entryActions')}
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-40">
          <Dropdown.Item onSelect={() => setMode({ kind: 'edit', entry })}>
            {t('timeTracking.editEntry')}
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() =>
              reportWrite(time.remove(entry), t('timeTracking.deleteFailed'))
            }
          >
            {t('timeTracking.deleteEntry')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );

  return (
    <>
      <TimePill
        ref={(element) => {
          anchor = element;
        }}
        minutes={props.minutes}
        aria-expanded={open()}
        onClick={() => {
          setMode({ kind: 'list' });
          setOpen(true);
        }}
      />
      <Popover
        open={open()}
        onOpenChange={setOpen}
        anchorRef={() => anchor}
        placement="bottom-start"
        gutter={6}
        fitViewport
      >
        <Popover.Portal>
          <Popover.Content
            aria-label={t('timeTracking.popoverTitle')}
            class="menu-surface z-modal flex max-h-[min(560px,calc(100dvh-24px))] w-80 flex-col gap-1 overflow-y-auto p-1 outline-none"
          >
            <Popover.Title class="sr-only">
              {t('timeTracking.popoverTitle')}
            </Popover.Title>
            <Switch>
              <Match
                when={(() => {
                  const current = mode();
                  return current.kind === 'edit' ? current.entry : undefined;
                })()}
              >
                {(entry) => (
                  <EntryForm
                    initial={entry()}
                    submitLabel={t('timeTracking.save')}
                    onCancel={() => setMode({ kind: 'list' })}
                    onSubmit={(values) => {
                      setMode({ kind: 'list' });
                      reportWrite(
                        time.update(entry(), values),
                        t('timeTracking.saveFailed')
                      );
                    }}
                  />
                )}
              </Match>
              <Match
                when={(() => {
                  const current = mode();
                  return current.kind === 'new' ? current : undefined;
                })()}
              >
                {(entry) => (
                  <EntryForm
                    initial={{ minutes: entry().minutes, date: today() }}
                    submitLabel={t('timeTracking.logTime')}
                    onCancel={() => setMode({ kind: 'list' })}
                    onSubmit={(values) => {
                      setMode({ kind: 'list' });
                      log(values);
                    }}
                  />
                )}
              </Match>
              <Match when={mode().kind === 'list'}>
                <Show when={props.canEdit}>
                  <LogTimeInput
                    today={today()}
                    onLog={logLength}
                    onCustom={(minutes) => setMode({ kind: 'new', minutes })}
                  />
                  <QuickLengths
                    onLog={(minutes) => logLength(minutes, today())}
                  />
                  <button
                    type="button"
                    onClick={() => setMode({ kind: 'new' })}
                    class="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-ink not-touch:hover:bg-hover"
                  >
                    <span>{t('timeTracking.customEntry')}</span>
                    <span class="text-xs text-ink-muted">
                      {t('timeTracking.customEntryHint')}
                    </span>
                  </button>
                  <div class="my-1 border-t border-edge-divider" />
                </Show>
                <EntriesSection
                  time={time}
                  today={today()}
                  person={props.person}
                  actions={actions}
                />
              </Match>
            </Switch>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </>
  );
}
