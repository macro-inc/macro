import type { NotionImportReport } from '@queries/import';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show } from 'solid-js';
import {
  type ImportReportItem,
  omissionCountLabel,
  omissionTotals,
  type ReviewOmission,
} from '../core/import-plan';

type Details = NonNullable<NotionImportReport['details']>;

const choicesByKind = [
  { kind: 'left_out', label: 'Left out by the reviewed plan' },
  { kind: 'excluded', label: 'Excluded in the review' },
  { kind: 'by_hand', label: 'Left for the agent' },
] satisfies { kind: ReviewOmission['kind']; label: string }[];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function Disclosure(props: {
  label: string;
  failure?: boolean;
  children: JSX.Element;
}) {
  return (
    <details open={props.failure} class="min-w-0 text-xs text-ink-muted">
      <summary
        class={cn(
          'min-h-8 content-center font-medium touch:min-h-11',
          props.failure ? 'text-failure' : 'text-ink'
        )}
      >
        {props.label}
      </summary>
      <div class="flex min-w-0 flex-col gap-2 pb-2 pl-3 wrap-break-word">
        {props.children}
      </div>
    </details>
  );
}

function SampleHint(props: { shown: number; total: number; noun: string }) {
  return (
    <Show when={props.shown < props.total}>
      <p>
        Showing {props.shown} of {plural(props.total, props.noun)}.
      </p>
    </Show>
  );
}

function PartialWrites(props: { confirmed: NotionImportReport['confirmed'] }) {
  const rows = () => props.confirmed?.partialDatabaseRows ?? 0;
  const tasks = () => props.confirmed?.partialTasks ?? 0;
  return (
    <>
      <Show when={rows() > 0}>
        <p>
          {plural(rows(), 'row')} {rows() === 1 ? 'was' : 'were'} copied into
          databases that did not finish importing.
        </p>
      </Show>
      <Show when={tasks() > 0}>
        <p>
          {plural(tasks(), 'task')} {tasks() === 1 ? 'was' : 'were'} copied into
          lists that did not finish importing.
        </p>
      </Show>
    </>
  );
}

/** Expandable outcome details shared by the thread card and full review. */
export function ImportReportDetails(props: {
  details: Details;
  failures: ImportReportItem[];
  failureCount: number;
  confirmed: NotionImportReport['confirmed'];
  error: string | null;
}) {
  const views = () =>
    props.details.viewChanges.flatMap((database) =>
      database.views.map((view) => ({ database: database.title, view }))
    );
  const choices = createMemo(() =>
    choicesByKind.map(({ kind, label }) => ({
      label,
      totals: omissionTotals(props.details, kind),
      items: props.details.notImported.filter((choice) => choice.kind === kind),
    }))
  );
  const omissions = createMemo(() =>
    props.details.notes.filter((note) => note.kind === 'omitted')
  );
  const otherNotes = createMemo(() =>
    props.details.notes.filter((note) => note.kind !== 'omitted')
  );
  const reviewed = () => omissionTotals(props.details);
  const omitted = () =>
    props.details.noteCounts?.find((entry) => entry.kind === 'omitted') ?? {
      count: omissions().reduce((count, note) => count + note.count, 0),
      lines: omissions().length,
    };
  const otherCount = () =>
    props.details.noteCounts
      ?.filter((entry) => entry.kind !== 'omitted')
      .reduce((total, entry) => total + entry.lines, 0) ?? otherNotes().length;
  const viewCount = () => props.details.viewCount ?? views().length;
  const shownViewChanges = () =>
    views().reduce((total, entry) => total + entry.view.changes.length, 0);
  const tabCount = () =>
    props.details.tabChoiceCount ?? props.details.tabChoices.length;
  const needsAttention = () =>
    props.failureCount > 0 ||
    Boolean(
      props.error ||
        props.confirmed?.partialDatabaseRows ||
        props.confirmed?.partialTasks
    );

  return (
    <Show
      when={
        needsAttention() ||
        reviewed().total ||
        viewCount() ||
        tabCount() ||
        omitted().count ||
        otherCount()
      }
    >
      <section
        aria-label="Import report"
        class="flex max-h-[40dvh] min-w-0 shrink-0 flex-col overflow-y-auto"
      >
        <Show when={needsAttention()}>
          <Disclosure
            label={
              props.failureCount > 0
                ? `Needs attention · ${plural(props.failureCount, 'item')}`
                : 'Needs attention'
            }
            failure
          >
            <Show when={props.error}>{(error) => <p>{error()}</p>}</Show>
            <PartialWrites confirmed={props.confirmed} />
            <Show when={props.failures.length > 0}>
              <ul class="list-disc space-y-2 pl-4">
                <For each={props.failures}>
                  {(failure) => (
                    <li>
                      <span class="text-ink">
                        {failure.title || 'Untitled'}
                      </span>
                      <Show when={failure.reason}> — {failure.reason}</Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <SampleHint
              shown={props.failures.length}
              total={props.failureCount}
              noun="item"
            />
          </Disclosure>
        </Show>
        <Show when={reviewed().total > 0}>
          <Disclosure
            label={`Not imported · ${omissionCountLabel(reviewed())}`}
          >
            <For each={choices()}>
              {({ label, items, totals }) => (
                <Show when={totals.total > 0}>
                  <p class="font-medium text-ink">
                    {label} · {omissionCountLabel(totals)}
                  </p>
                  <ul class="list-disc space-y-2 pl-4">
                    <For each={items}>
                      {({ item }) => (
                        <li>
                          <span class="text-ink">
                            {item.title || 'Untitled'}
                          </span>
                          <Show when={item.reason}>
                            {(reason) => <p>{reason()}</p>}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                  <SampleHint
                    shown={items.length}
                    total={totals.total}
                    noun="item"
                  />
                </Show>
              )}
            </For>
          </Disclosure>
        </Show>
        <Show when={omitted().count > 0}>
          <Disclosure
            label={`Couldn’t be copied · ${plural(omitted().count, 'item')}`}
          >
            <ul class="list-disc space-y-2 pl-4">
              <For each={omissions()}>{(note) => <li>{note.message}</li>}</For>
            </ul>
            <SampleHint
              shown={omissions().length}
              total={omitted().lines}
              noun="notice"
            />
          </Disclosure>
        </Show>
        <Show when={viewCount() > 0}>
          <Disclosure label={`View changes · ${plural(viewCount(), 'view')}`}>
            <ul class="list-disc space-y-2 pl-4">
              <For each={views()}>
                {({ database, view }) => (
                  <li>
                    <p>
                      <span class="font-medium text-ink">
                        {database} › {view.title}
                      </span>
                      <Show when={view.changes[0]}>
                        {(change) => <> · {change().message}</>}
                      </Show>
                    </p>
                    <Show when={view.changes.length > 1}>
                      <ul class="list-disc space-y-2 pl-4">
                        <For each={view.changes.slice(1)}>
                          {(change) => <li>{change.message}</li>}
                        </For>
                      </ul>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <SampleHint
              shown={views().length}
              total={viewCount()}
              noun="view"
            />
            <SampleHint
              shown={shownViewChanges()}
              total={props.details.viewChangeCount ?? shownViewChanges()}
              noun="change"
            />
          </Disclosure>
        </Show>
        <Show when={tabCount() > 0}>
          <Disclosure
            label={`Tab choices · ${plural(tabCount(), 'placement')}`}
          >
            <ul class="list-disc space-y-2 pl-4">
              <For each={props.details.tabChoices}>
                {(choice) => (
                  <li>
                    <span class="font-medium text-ink">
                      {choice.containerTitle
                        ? `${choice.containerTitle} › `
                        : ''}
                      {choice.database}
                    </span>
                    {' · '}
                    Notion didn’t say which tab was showing. We used{' '}
                    {choice.tab}.
                  </li>
                )}
              </For>
            </ul>
            <p>
              For these references, Macro used the first tab returned by Notion.
            </p>
            <SampleHint
              shown={props.details.tabChoices.length}
              total={tabCount()}
              noun="placement"
            />
          </Disclosure>
        </Show>
        <Show when={otherCount() > 0}>
          <Disclosure
            label={`Other details · ${plural(otherCount(), 'notice')}`}
          >
            <ul class="list-disc space-y-2 pl-4">
              <For each={otherNotes()}>{(note) => <li>{note.message}</li>}</For>
            </ul>
            <SampleHint
              shown={otherNotes().length}
              total={otherCount()}
              noun="notice"
            />
          </Disclosure>
        </Show>
      </section>
    </Show>
  );
}
