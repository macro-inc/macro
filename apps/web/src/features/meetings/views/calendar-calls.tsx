import { Button, Dialog, Panel } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  CalendarCallList,
  CalendarLiveCall,
} from '../components/calendar-call-list';
import type { CallAvatarRenderer } from '../components/calendar-person-avatar';
import type {
  CalendarCallsActions,
  CalendarCallsSource,
} from '../context/calendar-calls';
import type { CalendarCallItem } from '../core/calendar-calls';
import { createCalendarCalls } from '../primitives/calendar-calls';
import { CalendarCallDetailsView } from './calendar-call-details';

export function CalendarCalls(props: {
  source: CalendarCallsSource;
  actions: CalendarCallsActions;
  startCall?: JSX.Element;
  renderAvatar?: CallAvatarRenderer;
  renderInvite?: (item: CalendarCallItem) => JSX.Element;
}) {
  const state = createCalendarCalls(props.source, props.actions);
  const rowActions = {
    renderAvatar: props.renderAvatar,
    get renderDetails() {
      return state.detailsOpen()
        ? undefined
        : (item: CalendarCallItem, close: () => void) => (
            <CalendarCallDetailsView
              item={item}
              source={props.source}
              actions={props.actions}
              onClose={close}
              renderAvatar={props.renderAvatar}
              renderInvite={props.renderInvite}
            />
          );
    },
    get pending() {
      return state.pending();
    },
    get copiedUrl() {
      return state.copiedUrl();
    },
    onJoin: (item: CalendarCallItem) => void state.join(item),
    onCopy: (item: CalendarCallItem) => void state.share(item),
    onSelect: state.select,
    onOpenEvent: props.actions.openEvent
      ? (item: CalendarCallItem) => {
          if (item.event) props.actions.openEvent?.(item.event);
        }
      : undefined,
    onOpenRecord: (item: CalendarCallItem) => {
      if (item.record) props.actions.openRecord(item.record.id);
    },
  };
  return (
    <div class="@container/calendar-calls min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 @min-[700px]/calendar-calls:px-8">
        {props.startCall}
        <Show when={props.source.error()}>
          <div
            role="alert"
            class="flex items-center justify-between gap-3 rounded-lg border border-edge-muted p-3 text-xs text-ink-muted"
          >
            {props.source.error()}
            <Button
              size="sm"
              variant="ghost"
              disabled={props.source.refreshing()}
              onClick={props.source.refresh}
            >
              Try again
            </Button>
          </div>
        </Show>
        <Show when={state.error() && !state.detailsOpen()}>
          <p role="alert" class="text-xs text-failure">
            {state.error()}
          </p>
        </Show>
        <Show when={state.copiedUrl() && !state.detailsOpen()}>
          <span role="status" class="text-xs text-ink-muted">
            Call link copied
          </span>
        </Show>
        <For each={state.live()}>
          {(item) => (
            <CalendarLiveCall {...rowActions} item={item} now={state.now()} />
          )}
        </For>
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1" aria-label="Call history">
            <Button
              size="sm"
              variant={state.tab() === 'recent' ? 'outline' : 'ghost'}
              class="gap-1.5 rounded-lg"
              aria-pressed={state.tab() === 'recent'}
              onClick={() => state.setTab('recent')}
            >
              Recent{' '}
              <span class="text-ink-extra-muted">{state.recent().length}</span>
            </Button>
            <Button
              size="sm"
              variant={state.tab() === 'upcoming' ? 'outline' : 'ghost'}
              class="gap-1.5 rounded-lg"
              aria-pressed={state.tab() === 'upcoming'}
              onClick={() => state.setTab('upcoming')}
            >
              Upcoming{' '}
              <span class="text-ink-extra-muted">
                {state.upcoming().length}
              </span>
            </Button>
          </div>
        </div>
        <Show
          when={!props.source.loading()}
          fallback={
            <p class="py-10 text-center text-sm text-ink-muted">
              Loading calls…
            </p>
          }
        >
          <Show
            when={
              state.rows().length > 0 ||
              (state.tab() === 'upcoming' && state.links().length > 0)
            }
            fallback={
              <div class="rounded-xl border border-edge-muted bg-panel p-8 text-center">
                <p class="text-sm text-ink-muted">
                  {state.tab() === 'recent'
                    ? 'No recent calls.'
                    : 'No upcoming calls. Add a Macro call to an event, or create a link for later.'}
                </p>
                <Show when={state.tab() === 'upcoming'}>
                  <Button
                    size="sm"
                    variant="outline"
                    class="mt-4"
                    onClick={props.actions.schedule}
                  >
                    Create event
                  </Button>
                </Show>
              </div>
            }
          >
            <CalendarCallList
              {...rowActions}
              items={state.rows()}
              links={state.tab() === 'upcoming' ? state.links() : []}
              now={state.now()}
            />
          </Show>
        </Show>
        <Show when={state.tab() === 'recent' && props.source.hasMore()}>
          <Button
            class="self-center"
            size="sm"
            variant="ghost"
            disabled={props.source.refreshing()}
            onClick={props.source.loadMore}
          >
            Load older calls
          </Button>
        </Show>
      </div>
      <Dialog
        open={state.detailsOpen() && Boolean(state.selected())}
        onOpenChange={(open) => {
          if (!open) state.back();
        }}
        position="center"
        class="w-105 max-w-[calc(100vw-2rem)]"
      >
        <Panel depth={2} class="max-h-[85dvh] overflow-y-auto rounded-xl">
          <Dialog.Title class="sr-only">Call details</Dialog.Title>
          <Show when={state.selected()}>
            {(item) => (
              <CalendarCallDetailsView
                item={item()}
                source={props.source}
                actions={props.actions}
                onClose={state.back}
                renderAvatar={props.renderAvatar}
                renderInvite={props.renderInvite}
              />
            )}
          </Show>
        </Panel>
      </Dialog>
    </div>
  );
}
