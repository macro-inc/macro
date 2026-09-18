import { SettingsSheetContext } from '@app/features/settings/primitives';
import External from '@phosphor/arrow-square-out.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Chart from '@phosphor/chart-line.svg';
import Clock from '@phosphor/clock.svg';
import Copy from '@phosphor/copy.svg';
import Gear from '@phosphor/gear-six.svg';
import Link from '@phosphor/link.svg';
import Plugs from '@phosphor/plugs-connected.svg';
import Users from '@phosphor/users.svg';
import { cn } from '@ui';
import { createEffect, For, type JSX, on, Show, useContext } from 'solid-js';

export const schedulingPages = [
  {
    name: 'Event types',
    description:
      'Configure different events for people to book on your calendar.',
    icon: Link,
  },
  {
    name: 'Bookings',
    description: 'See upcoming and past events booked through your links.',
    icon: Calendar,
  },
  {
    name: 'Availability',
    description: 'Set the times you are available for meetings.',
    icon: Clock,
  },
  {
    name: 'Teams',
    description: 'Schedule together with your Macro team.',
    icon: Users,
  },
  {
    name: 'Insights',
    description: 'View booking insights across your events.',
    icon: Chart,
  },
  {
    name: 'Booking page',
    description: 'Make your public booking page feel like you.',
    icon: Gear,
  },
];

export function SchedulingWorkspace(props: {
  page: string;
  onNavigate: (page: string) => void;
  title?: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
  publicLink?: string;
  onCopy: () => void;
  onConnections: () => void;
  editor?: boolean;
}) {
  const inSheet = useContext(SettingsSheetContext);
  let scrollBody: HTMLElement | undefined;
  createEffect(
    on([() => props.page, () => props.editor, () => props.title], () =>
      scrollBody?.scrollTo({ top: 0 })
    )
  );
  return (
    <div class="@container/workspace h-full min-h-0 bg-page text-ink select-children">
      <div class="flex h-full min-h-0 flex-col @min-[900px]/workspace:flex-row">
        <Show when={!props.editor}>
          <aside class="flex shrink-0 flex-col gap-5 px-3 py-4 @min-[900px]/workspace:w-52 @min-[900px]/workspace:py-7">
            <div class="hidden items-center gap-2 px-3 @min-[900px]/workspace:flex">
              <Calendar class="size-5" />
              <span class="text-lg font-semibold tracking-tight">
                Scheduling
              </span>
            </div>
            <nav
              aria-label="Scheduling"
              class="flex gap-1 overflow-x-auto @min-[900px]/workspace:flex-col"
            >
              <For each={schedulingPages}>
                {(item) => (
                  <button
                    type="button"
                    aria-current={props.page === item.name ? 'page' : undefined}
                    onClick={() => props.onNavigate(item.name)}
                    class={cn(
                      'flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover',
                      props.page === item.name
                        ? 'bg-active font-medium text-ink'
                        : 'text-ink-muted'
                    )}
                  >
                    <item.icon class="size-[18px] shrink-0" />
                    {item.name}
                  </button>
                )}
              </For>
            </nav>
            <div class="mt-auto hidden flex-col gap-1 @min-[900px]/workspace:flex">
              <Show when={props.publicLink}>
                <a
                  class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-hover"
                  href={props.publicLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <External class="size-[18px]" />
                  View public page
                </a>
              </Show>
              <button
                type="button"
                disabled={!props.publicLink}
                onClick={props.onCopy}
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-hover disabled:opacity-40"
              >
                <Copy class="size-[18px]" />
                Copy public page link
              </button>
              <button
                type="button"
                onClick={props.onConnections}
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-hover"
              >
                <Plugs class="size-[18px]" />
                Connected calendars
              </button>
            </div>
          </aside>
        </Show>
        <main
          ref={scrollBody}
          data-drawer-scroll-body={inSheet ? true : undefined}
          class="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-t-2xl border border-edge-muted bg-panel [scrollbar-gutter:stable] [overflow-anchor:none] @min-[900px]/workspace:my-2 @min-[900px]/workspace:mr-2 @min-[900px]/workspace:rounded-2xl"
        >
          <div class="@container mx-auto flex w-full max-w-[1600px] flex-col gap-7 px-5 py-7 @min-[700px]/workspace:px-8 @min-[1200px]/workspace:px-10 @min-[1200px]/workspace:py-9">
            <Show when={props.title}>
              <header class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 class="text-xl font-semibold tracking-tight">
                    {props.title}
                  </h1>
                  <Show when={props.description}>
                    <p class="mt-1 text-sm text-ink-muted">
                      {props.description}
                    </p>
                  </Show>
                </div>
                {props.actions}
              </header>
            </Show>
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}
