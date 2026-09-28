import { type JSX, Show } from 'solid-js';

/** Board and controls on the left, room and team context beside them. */
export function RoomLayout(props: {
  title: string;
  status: JSX.Element;
  actions?: JSX.Element;
  players?: JSX.Element;
  message?: JSX.Element;
  board: JSX.Element;
  footer?: JSX.Element;
  sidebar: JSX.Element;
}) {
  return (
    <div class="@container/game size-full min-h-0 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 @3xl/game:flex-row @3xl/game:items-start @3xl/game:p-8">
        <section class="flex min-w-0 flex-1 flex-col items-center gap-4">
          <header class="flex w-full flex-wrap items-center gap-2">
            <h2 class="font-semibold text-ink text-lg">{props.title}</h2>
            {props.status}
            <Show when={props.actions}>
              <div class="ml-auto flex flex-wrap items-center gap-2">
                {props.actions}
              </div>
            </Show>
          </header>
          <Show when={props.players}>
            <div class="w-full">{props.players}</div>
          </Show>
          <Show when={props.message}>
            <p
              class="min-h-6 w-full text-center font-medium text-ink text-sm"
              aria-live="polite"
            >
              {props.message}
            </p>
          </Show>
          {props.board}
          {props.footer}
        </section>
        <aside class="flex w-full flex-col gap-4 @3xl/game:w-72 @3xl/game:shrink-0">
          {props.sidebar}
        </aside>
      </div>
    </div>
  );
}

export function PanelSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="rounded-2xl border border-edge-muted bg-panel p-3">
      <h3 class="mb-2 px-2 font-semibold text-ink-subtle text-xs uppercase tracking-wide">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}
