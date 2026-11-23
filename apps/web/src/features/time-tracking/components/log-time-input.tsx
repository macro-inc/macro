import { formatLocale, t } from '@app/lib/i18n';
import { Input } from '@ui/components/Input';
import { parseISO } from 'date-fns';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { dayBefore } from '../core/entry-days';
import { formatLength } from '../core/format-length';
import { MAX_ENTRY_MINUTES, parseLength } from '../core/parse-length';

type LogTimeInputProps = {
  /** The device's calendar day, `YYYY-MM-DD`. */
  today: string;
  onLog: (minutes: number, day: string) => void;
  /** Open the full entry form with this length, to pick a day or add a note. */
  onCustom: (minutes: number) => void;
  disabled?: boolean;
};

function shortDate(day: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseISO(day));
}

function Row(props: {
  onClick: () => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onClick()}
      class="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-ink not-touch:hover:bg-hover disabled:text-ink-extra-muted touch:min-h-[44px]"
    >
      <span class="truncate">{props.label}</span>
      <Show when={props.hint}>
        <span class="shrink-0 text-xs text-ink-muted">{props.hint}</span>
      </Show>
    </button>
  );
}

/**
 * The forgiving length input: it shows what it understood before anything is
 * saved, and Enter logs that length for today.
 */
export function LogTimeInput(props: LogTimeInputProps): JSX.Element {
  const [text, setText] = createSignal('');
  const parsed = () => parseLength(text());
  const understood = () => {
    const current = parsed();
    return current.kind === 'length' ? current.minutes : undefined;
  };
  const log = (minutes: number, day: string) => {
    setText('');
    props.onLog(minutes, day);
  };
  return (
    <div class="flex flex-col gap-1">
      <Input
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          const current = parsed();
          if (event.key !== 'Enter' || current.kind !== 'length') return;
          event.preventDefault();
          log(current.minutes, props.today);
        }}
        placeholder={t('timeTracking.inputPlaceholder')}
        aria-label={t('timeTracking.inputLabel')}
        disabled={props.disabled}
        size="sm"
      />
      <Show when={text().trim().length > 0}>
        <Switch>
          <Match when={parsed().kind === 'too-long'}>
            <p class="px-2 py-1.5 text-sm text-ink-muted">
              {t('timeTracking.tooLong', { hours: MAX_ENTRY_MINUTES / 60 })}
            </p>
          </Match>
          <Match when={parsed().kind === 'invalid'}>
            <p class="px-2 py-1.5 text-sm text-ink-muted">
              {t('timeTracking.unreadable')}
            </p>
          </Match>
          <Match when={understood()}>
            {(minutes) => {
              const length = () => formatLength(minutes());
              return (
                <div class="flex flex-col">
                  <Row
                    label={t('timeTracking.logToday', { length: length() })}
                    hint={t('timeTracking.logTodayHint')}
                    onClick={() => log(minutes(), props.today)}
                    disabled={props.disabled}
                  />
                  <Row
                    label={t('timeTracking.logYesterday', { length: length() })}
                    hint={shortDate(dayBefore(props.today))}
                    onClick={() => log(minutes(), dayBefore(props.today))}
                    disabled={props.disabled}
                  />
                  <Row
                    label={t('timeTracking.logOnDay', { length: length() })}
                    hint={t('timeTracking.pickDay')}
                    onClick={() => props.onCustom(minutes())}
                    disabled={props.disabled}
                  />
                  <Row
                    label={t('timeTracking.addNote')}
                    onClick={() => props.onCustom(minutes())}
                    disabled={props.disabled}
                  />
                </div>
              );
            }}
          </Match>
        </Switch>
      </Show>
    </div>
  );
}

/** One-tap lengths logged for today. */
export function QuickLengths(props: {
  onLog: (minutes: number) => void;
  disabled?: boolean;
  /** Chips in a row, for a phone sheet; rows otherwise. */
  chips?: boolean;
}): JSX.Element {
  const lengths = [15, 30, 60, 120];
  return (
    <Show
      when={props.chips}
      fallback={
        <div class="flex flex-col">
          {lengths.map((minutes) => (
            <Row
              label={t('timeTracking.quickLength', {
                length: formatLength(minutes),
              })}
              hint={t('timeTracking.today')}
              onClick={() => props.onLog(minutes)}
              disabled={props.disabled}
            />
          ))}
        </div>
      }
    >
      <div class="grid grid-cols-4 gap-2">
        {lengths.map((minutes) => (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onLog(minutes)}
            aria-label={t('timeTracking.quickLength', {
              length: formatLength(minutes),
            })}
            class="min-h-[44px] rounded-full border border-edge-muted text-sm text-ink disabled:text-ink-extra-muted"
          >
            {formatLength(minutes)}
          </button>
        ))}
      </div>
    </Show>
  );
}
