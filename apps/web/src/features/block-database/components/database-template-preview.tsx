import PlusIcon from '@phosphor/plus.svg';
import type { DatabaseTemplateId } from '@service-storage/generated/schemas/databaseTemplateId';
import { For, type ParentProps } from 'solid-js';
import { match } from 'ts-pattern';

function PreviewWindow(props: ParentProps<{ title: string }>) {
  return (
    <div class="w-full self-start overflow-hidden rounded-t-lg border border-edge-muted bg-panel text-[9px] leading-normal text-ink shadow-sm">
      <div class="flex items-center gap-1.5 border-b border-edge-muted px-2.5 py-2 font-medium">
        <span class="size-1.5 rounded-full bg-ink-placeholder" />
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function BoardPreview(props: {
  title: string;
  columns: { name: string; cards: string[] }[];
}) {
  return (
    <PreviewWindow title={props.title}>
      <div class="grid grid-cols-3 gap-1.5 p-2">
        <For each={props.columns}>
          {(column, index) => (
            <div class="flex min-w-0 flex-col gap-1.5">
              <div class="flex items-center gap-1 text-[8px] text-ink-muted">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  classList={{
                    'bg-ink-placeholder': index() === 0,
                    'bg-blue': index() === 1,
                    'bg-success': index() === 2,
                  }}
                />
                <span class="truncate">{column.name}</span>
              </div>
              <For each={column.cards}>
                {(card) => (
                  <div class="rounded border border-edge-muted bg-surface-0 px-1.5 py-2 text-[8px]">
                    {card}
                    <div class="mt-2 h-1 w-2/3 rounded-full bg-hover" />
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </PreviewWindow>
  );
}

function BlankPreview() {
  return (
    <PreviewWindow title="Your database">
      <div class="grid grid-cols-[1fr_2rem] border-b border-edge-muted text-ink-muted">
        <span class="border-r border-edge-muted px-3 py-1.5">Name</span>
        <span class="flex items-center justify-center">
          <PlusIcon class="size-2.5" />
        </span>
      </div>
      <div class="relative h-20 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_23px,var(--color-edge-muted)_23px,var(--color-edge-muted)_24px)]">
        <div class="absolute top-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-edge-muted bg-panel text-ink-muted">
          <PlusIcon class="size-4" />
        </div>
      </div>
    </PreviewWindow>
  );
}

function EventPreview() {
  return (
    <PreviewWindow title="Parties / Invites">
      <div class="grid grid-cols-[1fr_auto] gap-x-3 border-b border-edge-muted px-2.5 py-1.5 text-ink-muted">
        <span>Guest name</span>
        <span>RSVP</span>
      </div>
      <For each={['Jordan Lee', 'Priya Shah', 'Marco Rossi']}>
        {(name, index) => (
          <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-2.5 py-2">
            <span>{name}</span>
            <span
              class="rounded px-1.5 py-0.5 text-[8px]"
              classList={{
                'bg-success-bg text-success': index() < 2,
                'bg-warning-bg text-warning': index() === 2,
              }}
            >
              {index() < 2 ? 'Going' : 'Maybe'}
            </span>
          </div>
        )}
      </For>
    </PreviewWindow>
  );
}

function ContentPreview() {
  return (
    <PreviewWindow title="Posts">
      <div class="grid grid-cols-[1fr_auto] border-b border-edge-muted px-2.5 py-1.5 text-ink-muted">
        <span>Title</span>
        <span>Channel</span>
      </div>
      <For
        each={[
          ['Our year in review', 'Blog'],
          ['Monthly product update', 'Newsletter'],
          ['Behind the scenes', 'LinkedIn'],
        ]}
      >
        {(row) => (
          <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-2.5 py-2">
            <span class="truncate">{row[0]}</span>
            <span class="rounded bg-blue-bg px-1.5 py-0.5 text-[8px] text-blue">
              {row[1]}
            </span>
          </div>
        )}
      </For>
    </PreviewWindow>
  );
}

function ReadingPreview() {
  return (
    <PreviewWindow title="Books">
      <For
        each={[
          ['The Design of Everyday Things', 'Don Norman'],
          ['Thinking in Systems', 'Donella Meadows'],
          ['The Pragmatic Programmer', 'Thomas & Hunt'],
        ]}
      >
        {(book, index) => (
          <div class="flex items-center gap-2 border-b border-edge-muted px-2.5 py-2">
            <span
              class="h-7 w-5 shrink-0 rounded-r border-l-2"
              classList={{
                'border-warning bg-warning-bg': index() === 0,
                'border-success bg-success-bg': index() === 1,
                'border-blue bg-blue-bg': index() === 2,
              }}
            />
            <div class="min-w-0">
              <div class="truncate">{book[0]}</div>
              <div class="text-[8px] text-ink-muted">{book[1]}</div>
            </div>
          </div>
        )}
      </For>
    </PreviewWindow>
  );
}

/** Decorative sketches of the starting data, not interactive database views. */
export function DatabaseTemplatePreview(props: {
  template?: DatabaseTemplateId;
}) {
  return (
    <div
      aria-hidden="true"
      class="flex h-36 overflow-hidden border-b border-edge-muted px-4 pt-6"
      classList={{
        'bg-surface-1': props.template === undefined,
        'bg-blue-bg': props.template === 'project_tracker',
        'bg-warning-bg': props.template === 'event_planner',
        'bg-accent-bg': props.template === 'content_calendar',
        'bg-success-bg': props.template === 'reading_list',
        'bg-hover': props.template === 'getting_started',
      }}
    >
      {match(props.template)
        .with(undefined, () => <BlankPreview />)
        .with('project_tracker', () => (
          <BoardPreview
            title="Tasks"
            columns={[
              { name: 'To do', cards: ['Plan the launch'] },
              { name: 'In progress', cards: ['Review the designs'] },
              { name: 'Done', cards: ['Write the brief'] },
            ]}
          />
        ))
        .with('event_planner', () => <EventPreview />)
        .with('content_calendar', () => <ContentPreview />)
        .with('reading_list', () => <ReadingPreview />)
        .with('getting_started', () => (
          <BoardPreview
            title="Ideas"
            columns={[
              { name: 'To do', cards: ['Add your first idea'] },
              { name: 'Doing', cards: ['Try moving a card'] },
              { name: 'Done', cards: ['Explore views'] },
            ]}
          />
        ))
        .exhaustive()}
    </div>
  );
}
