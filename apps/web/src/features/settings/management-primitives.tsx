import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Search from '@phosphor/magnifying-glass.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

export const managementPrimary =
  'h-9 rounded-lg bg-ink text-panel hover:bg-ink/90 px-3 text-[13px]';

/** Management pages share the same surfaces and spacing as the agent workspace. */
export function ManagementPage(props: {
  title: string;
  description?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="@container h-full min-h-0 overflow-y-auto [overflow-anchor:none]">
      <div class="mx-auto w-full max-w-5xl px-6 py-10 @3xl:px-10 touch:pt-[calc(var(--mobile-content-inset-top,0px)+2rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+3rem)]">
        <header class="flex flex-col items-start justify-between gap-5 @xl:flex-row">
          <div class="min-w-0">
            <h1 class="text-2xl font-medium tracking-tight text-ink">
              {props.title}
            </h1>
            <Show when={props.description}>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
                {props.description}
              </p>
            </Show>
          </div>
          <Show when={props.actions}>
            <div class="shrink-0">{props.actions}</div>
          </Show>
        </header>
        <div class="mt-9 flex flex-col gap-9 pb-14">{props.children}</div>
      </div>
    </div>
  );
}

export function ManagementSection(props: {
  title?: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <section class={cn('flex flex-col gap-3', props.class)}>
      <Show when={props.title || props.actions}>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Show when={props.title}>
              <h2 class="text-sm font-medium text-ink">{props.title}</h2>
            </Show>
            <Show when={props.description}>
              <p class="mt-1 text-xs leading-5 text-ink-muted">
                {props.description}
              </p>
            </Show>
          </div>
          {props.actions}
        </div>
      </Show>
      {props.children}
    </section>
  );
}

export function ManagementCard(props: {
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'overflow-hidden rounded-2xl border border-edge-muted bg-ink/2 settings-row-dividers',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/** An in-page editor with parent navigation, replacing a modal workflow. */
export function ManagementEditor(props: {
  title: string;
  parent: string;
  onBack: () => void;
  pending?: boolean;
  children: JSX.Element;
  actions?: JSX.Element;
  contentRef?: (element: HTMLDivElement) => void;
}) {
  return (
    <section
      aria-label={props.title}
      class="flex h-full min-h-0 flex-col text-ink"
    >
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-edge-muted px-6 text-sm">
        <button
          type="button"
          disabled={props.pending}
          onClick={props.onBack}
          class="rounded text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {props.parent}
        </button>
        <CaretRight class="size-3 text-ink-extra-muted" />
        <span class="truncate">{props.title}</span>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={props.contentRef}
          class="mx-auto max-w-4xl px-6 py-8 sm:px-10"
        >
          <button
            type="button"
            disabled={props.pending}
            onClick={props.onBack}
            class="mb-6 flex items-center gap-2 rounded text-xs text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ArrowLeft class="size-3.5" />
            Back to {props.parent.toLowerCase()}
          </button>
          <h1 class="mb-8 text-2xl font-medium tracking-tight">
            {props.title}
          </h1>
          {props.children}
          <Show when={props.actions}>
            <footer class="mt-8 flex justify-end gap-2 border-t border-edge-muted pt-5 pb-10">
              {props.actions}
            </footer>
          </Show>
        </div>
      </div>
    </section>
  );
}

export function ManagementSearch(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <label class="flex h-9 w-56 max-w-full items-center gap-2 rounded-lg border border-edge-muted bg-ink/2 px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent/40">
      <Search class="size-4 shrink-0" />
      <input
        type="search"
        aria-label={props.label}
        placeholder={`${props.label}…`}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        class="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-extra-muted"
      />
    </label>
  );
}
