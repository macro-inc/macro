import { isMobile } from '@core/mobile/isMobile';
import type { NotionImportReport } from '@queries/import';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ImportReportItem } from '../core/import-plan';

type Details = NonNullable<NotionImportReport['details']>;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function Disclosure(props: {
  label: string;
  open?: boolean;
  children: JSX.Element;
}) {
  return (
    <details open={props.open} class="min-w-0 text-xs text-ink-muted">
      <summary class="min-h-11 content-center font-medium text-ink">
        {props.label}
      </summary>
      <div class="flex min-w-0 flex-col gap-2 pb-2 pl-3 wrap-break-word">
        {props.children}
      </div>
    </details>
  );
}

/** Expandable outcome details shared by the thread card and full review. */
export function ImportReportDetails(props: {
  details: Details;
  failures: ImportReportItem[];
  error: string | null;
}) {
  const viewCount = () =>
    props.details.viewChanges.reduce(
      (count, database) => count + database.views.length,
      0
    );
  const omissions = () =>
    props.details.notes.filter((note) => note.kind === 'omitted');
  const otherNotes = () =>
    props.details.notes.filter((note) => note.kind !== 'omitted');
  const omittedCount = () =>
    props.details.notImported.length +
    omissions().reduce((count, note) => count + note.count, 0);
  const noteCount = () =>
    otherNotes().reduce((count, note) => count + note.count, 0);
  return (
    <section
      aria-label="Import report"
      class="flex max-h-[40dvh] min-w-0 shrink-0 flex-col overflow-y-auto"
    >
      <Show when={props.failures.length > 0 || props.error}>
        <Disclosure label="Needs attention" open={!isMobile()}>
          <Show
            when={props.failures.length > 0}
            fallback={<p>{props.error}</p>}
          >
            <ul class="flex flex-col gap-1">
              <For each={props.failures}>
                {(failure) => (
                  <li>
                    <span class="text-ink">{failure.title || 'Untitled'}</span>
                    <Show when={failure.reason}> — {failure.reason}</Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Disclosure>
      </Show>
      <Show when={omittedCount() > 0}>
        <Disclosure label={`Not imported · ${plural(omittedCount(), 'item')}`}>
          <ul class="flex flex-col gap-2">
            <For each={props.details.notImported}>
              {({ kind, item }) => (
                <li>
                  <span class="text-ink">{item.title || 'Untitled'}</span>
                  {' · '}
                  {match(kind)
                    .with('left_out', () => 'Left out by the reviewed plan')
                    .with('excluded', () => 'Excluded in the review')
                    .with('by_hand', () => 'Left for you to handle')
                    .exhaustive()}
                  <Show when={item.reason}>
                    {(reason) => <p>{reason()}</p>}
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={omissions().length > 0}>
            <h4 class="font-medium text-ink">Couldn’t be copied</h4>
            <ul class="flex flex-col gap-1">
              <For each={omissions()}>{(note) => <li>{note.message}</li>}</For>
            </ul>
          </Show>
        </Disclosure>
      </Show>
      <Show when={viewCount() > 0}>
        <Disclosure label={`View changes · ${plural(viewCount(), 'view')}`}>
          <For each={props.details.viewChanges}>
            {(database) => (
              <section aria-label={database.title} class="flex flex-col gap-1">
                <h4 class="font-medium text-ink">{database.title}</h4>
                <For each={database.views}>
                  {(view) => (
                    <section
                      aria-label={view.title}
                      class="flex flex-col gap-1"
                    >
                      <h5 class="text-ink">{view.title}</h5>
                      <ul class="flex flex-col gap-1 pl-3">
                        <For each={view.changes}>
                          {(change) => <li>{change.message}</li>}
                        </For>
                      </ul>
                    </section>
                  )}
                </For>
              </section>
            )}
          </For>
        </Disclosure>
      </Show>
      <Show when={props.details.tabChoices.length > 0}>
        <Disclosure
          label={`Tab choices · ${plural(props.details.tabChoices.length, 'placement')}`}
        >
          <p>
            For these references, Macro used the first tab returned by Notion.
          </p>
          <ul class="flex flex-col gap-1">
            <For each={props.details.tabChoices}>
              {(choice) => (
                <li>
                  <span class="text-ink">{choice.database}</span>
                  {' · '}
                  Notion didn't say which tab was showing; we used {choice.tab}.
                </li>
              )}
            </For>
          </ul>
        </Disclosure>
      </Show>
      <Show when={noteCount() > 0}>
        <Disclosure label={`Other details · ${plural(noteCount(), 'notice')}`}>
          <ul class="flex flex-col gap-1">
            <For each={otherNotes()}>{(note) => <li>{note.message}</li>}</For>
          </ul>
        </Disclosure>
      </Show>
    </section>
  );
}
