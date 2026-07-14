import { type JSX, Match, Switch } from 'solid-js';

/**
 * Icon + title + description row in the shared home style. Renders as a link
 * when `href` is set, a button when `onActivate` is set, and a static row
 * otherwise.
 */
export function SetupRow(props: {
  icon: JSX.Element;
  title: string;
  desc: JSX.Element;
  trailing?: JSX.Element;
  onActivate?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-muted">
        {props.icon}
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-ink">{props.title}</div>
        <div class="text-xs text-ink-muted">{props.desc}</div>
      </div>
      {props.trailing}
    </>
  );
  return (
    <Switch
      fallback={
        <div class="group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left">
          {inner}
        </div>
      }
    >
      <Match when={props.href}>
        <a
          class="group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left transition-colors hover:bg-hover"
          href={props.href}
          target="_blank"
          rel="noreferrer"
        >
          {inner}
        </a>
      </Match>
      <Match when={props.onActivate}>
        <button
          type="button"
          class="group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left transition-colors hover:bg-hover"
          onClick={props.onActivate}
        >
          {inner}
        </button>
      </Match>
    </Switch>
  );
}
