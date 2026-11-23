import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { Button } from '@ui/components/Button';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { EntryList } from '../../components/entry-list';
import type { TaskTime } from '../../primitives/create-task-time';

type EntriesSectionProps = {
  time: TaskTime;
  today: string;
  person: (userId: string) => JSX.Element;
  row?: (entry: TimeEntryFieldsFragment, content: JSX.Element) => JSX.Element;
  actions?: (entry: TimeEntryFieldsFragment) => JSX.Element;
};

/** The task's entries with their loading, failed and empty states. */
export function EntriesSection(props: EntriesSectionProps): JSX.Element {
  return (
    <Switch
      fallback={
        <>
          <EntryList
            entries={props.time.entries()}
            today={props.today}
            person={props.person}
            row={props.row}
            actions={props.actions}
          />
          <Show when={props.time.hasOlder()}>
            <Button
              variant="ghost"
              size="sm"
              class="self-start"
              disabled={props.time.olderPending()}
              onClick={() => props.time.showOlder()}
            >
              {t('timeTracking.showOlder')}
            </Button>
          </Show>
        </>
      }
    >
      <Match when={props.time.pending() && props.time.entries().length === 0}>
        <ListSkeleton.Root
          label={t('timeTracking.loadingEntries')}
          class="px-2 py-1"
        >
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-3 w-40" />
          </ListSkeleton.Row>
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-3 w-32" />
          </ListSkeleton.Row>
        </ListSkeleton.Root>
      </Match>
      <Match when={props.time.failed() && props.time.entries().length === 0}>
        <div class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-ink-muted">
          <span>{t('timeTracking.entriesFailed')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.time.refetch()}
          >
            {t('timeTracking.retry')}
          </Button>
        </div>
      </Match>
      <Match when={props.time.entries().length === 0}>
        <p class="px-2 py-1.5 text-sm text-ink-muted">
          {t('timeTracking.noEntries')}
        </p>
      </Match>
    </Switch>
  );
}
