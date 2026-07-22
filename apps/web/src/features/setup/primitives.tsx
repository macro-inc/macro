import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import { cn, Layer } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { StatusDot } from '../settings/integration-ui';

/*
 * Building blocks for the /setup import panel: one bordered card per
 * connected source, whose body is a cloud of narrow, content-fit pills.
 * Selection happens per-card (a section-level toggle), never per-pill.
 */

/**
 * One source's card: a connector-first header (icon, name, count badge,
 * right-aligned actions), a recessed status well underneath — the same
 * inset treatment as the soup's active-filters bar — carrying the green
 * "Connected" dot and a blurb saying what Macro found, and the pill cloud
 * as the body.
 */
export function ImportCard(props: {
  /** The connector's brand icon. */
  icon?: JSX.Element;
  /** The connector's name ("Notion") — the card leads with the tool. */
  title: string;
  /** Item count shown in a rounded badge beside the title. */
  count?: number;
  /** Lead the status well with the green dot + "Connected —". */
  connected?: boolean;
  /** Right-aligned header controls (the section import toggle). */
  actions?: JSX.Element;
  /**
   * Status blurb rendered in the well after the "Connected —" lead-in, so
   * it should start lowercase ("here are 10 issues…").
   */
  status: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <Layer depth={2}>
      <section class="flex flex-col gap-3 rounded-xl border border-ink/[0.05] bg-surface p-5">
        <div class="flex items-center gap-2">
          <Show when={props.icon}>
            <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
              {props.icon}
            </span>
          </Show>
          <h3 class="min-w-0 truncate text-sm font-semibold text-ink">
            {props.title}
          </h3>
          <Show when={props.count !== undefined}>
            <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
              {props.count}
            </span>
          </Show>
          <Show when={props.actions}>
            <span class="ml-auto flex shrink-0 items-center gap-2">
              {props.actions}
            </span>
          </Show>
        </div>
        {/* Recessed status well (Layer depth 0 drops bg-surface to the
            darkest level, same as the soup active-filters bar). */}
        <Layer depth={0}>
          <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-edge-muted bg-surface px-3 py-2.5 text-[13px] text-ink-muted">
            <Show when={props.connected}>
              <StatusDot state="connected" />
              <span class="font-medium text-ink">Connected</span>
              <span>—</span>
            </Show>
            {props.status}
          </div>
        </Layer>
        <Show when={props.children}>{props.children}</Show>
      </section>
    </Layer>
  );
}

/** Wrapping row of narrow pills. */
export function PillGrid(props: { children: JSX.Element }) {
  return <div class="flex flex-wrap gap-1.5">{props.children}</div>;
}

/**
 * A narrow, content-fit pill for one importable item, whose content reads
 * like an inline @ mention: entity icon, optional muted identifier, the name
 * with the mention underline, then trailing status. Width hugs the content
 * (name truncated past a cap) so a section reads as a compact cloud instead
 * of a full-width list. Pills are display-only — whether they import is
 * decided by the card's section toggle — except imported ones, which open
 * the entity they became.
 */
export function ItemPill(props: {
  icon?: JSX.Element;
  /** Muted shorthand before the name (e.g. a Linear identifier "MAC-42"). */
  code?: string;
  label: string;
  /** Trailing status icons (e.g. an in-flight spinner). */
  status?: JSX.Element;
  /** Hover detail (subtitle/description); falls back to the label. */
  title?: string;
  /**
   * The Macro entity this item already became (imported by the user or a
   * teammate). Renders as a quiet "already in your workspace" pill that
   * opens the existing entity.
   */
  importedHref?: string;
}) {
  const content = (
    <>
      <Show when={props.icon}>
        <span
          class={cn(
            'flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5',
            props.importedHref !== undefined ? 'opacity-50' : 'opacity-90'
          )}
        >
          {props.icon}
        </span>
      </Show>
      <Show when={props.code}>
        <span class="shrink-0 text-xs tabular-nums text-ink-extra-muted">
          {props.code}
        </span>
      </Show>
      <span class="min-w-0 truncate underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.label}
      </span>
      <Show when={props.status}>
        <span class="flex shrink-0 items-center gap-1">{props.status}</span>
      </Show>
    </>
  );
  const base =
    'inline-flex h-7 max-w-72 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]';

  return (
    <Show
      when={props.importedHref}
      fallback={
        <span
          title={props.title ?? props.label}
          class={cn(base, 'border-ink/10 bg-surface text-ink')}
        >
          {content}
        </span>
      }
    >
      {(href) => (
        <button
          type="button"
          title="Already in your workspace — click to open"
          onClick={() => window.open(href(), '_blank')}
          class={cn(
            base,
            'cursor-default border-ink/5 bg-ink/[0.03] text-ink-extra-muted outline-none',
            'transition-colors hover:text-ink-muted focus-visible:ring-1 focus-visible:ring-accent/50'
          )}
        >
          {content}
          <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
            <CheckIcon class="size-3 shrink-0" />
            in Macro
          </span>
        </button>
      )}
    </Show>
  );
}

const SKELETON_WIDTHS = [88, 128, 72, 148, 104, 80, 136, 96];

/**
 * Shimmering placeholder pills while a gather job runs: ghost outlines of
 * the real pills (icon dot + text bar) pulsing on a slight stagger. Renders
 * bare spans so it can sit inside a `PillGrid` after the pills that already
 * landed.
 */
export function SkeletonPills(props: { count?: number }) {
  return (
    <For each={SKELETON_WIDTHS.slice(0, props.count ?? 6)}>
      {(width, index) => (
        <span
          class="flex h-7 w-(--pill-width) animate-pulse items-center gap-1.5 rounded-lg border border-ink/5 px-2.5 [animation-delay:var(--pill-delay)]"
          style={{
            '--pill-width': `${width}px`,
            '--pill-delay': `${index() * 150}ms`,
          }}
        >
          <span class="size-3.5 shrink-0 rounded-full bg-ink/10" />
          <span class="h-2 min-w-0 flex-1 rounded-full bg-ink/10" />
        </span>
      )}
    </For>
  );
}

/** Inline failure note with a retry affordance. */
export function FailureNote(props: { message?: string; onRetry: () => void }) {
  return (
    <span class="flex items-center gap-3">
      <span class="min-w-0 truncate">
        {props.message ?? "Something went wrong — this one's on us."}
      </span>
      <button
        type="button"
        class="shrink-0 font-medium text-ink-muted transition-colors hover:text-ink"
        onClick={() => props.onRetry()}
      >
        Retry
      </button>
    </span>
  );
}
