import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import { cn, Layer } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';

/*
 * Building blocks for the /setup import panel. The left rail reuses the
 * settings primitives directly; these cover what settings has no equivalent
 * for — quiet sections whose content is rows of narrow, content-fit pills
 * rather than full-width rows.
 */

/**
 * One titled section of the import panel, headed by the same bar the soup's
 * group-by headers use (SoupSectionHeader): collapse chevron, title, count
 * badge, an optional provenance note ("from Linear"), and right-aligned
 * quiet actions. The chevron collapses the section body.
 */
export function BuilderSection(props: {
  title: string;
  /** Item count shown in the soup-style rounded badge. */
  count?: number;
  /** Provenance / status note rendered after the title. */
  meta?: JSX.Element;
  /** Right-aligned quiet controls (selection count, dismiss…). */
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <section class="flex flex-col gap-2.5">
      <SoupSectionHeader class="mx-0 my-0 w-full">
        {/* The header itself stays a div (actions are buttons), so the
            chevron carries the collapse behavior — same box the soup
            group headers render. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          class="cursor-default"
        >
          <Layer depth={3}>
            <div class="flex size-4.5 items-center justify-center rounded-xs hover:bg-ink/5">
              <ChevronRightIcon
                class={cn('size-2.5', expanded() && 'rotate-90')}
              />
            </div>
          </Layer>
        </button>
        <span class="truncate">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
            {props.count}
          </span>
        </Show>
        <Show when={props.meta}>{props.meta}</Show>
        <Show when={props.actions}>
          <span class="ml-auto flex shrink-0 items-center gap-2 font-normal">
            {props.actions}
          </span>
        </Show>
      </SoupSectionHeader>
      <Show when={expanded()}>{props.children}</Show>
    </section>
  );
}

/** "from <icon> Linear" provenance note beside a section title. */
export function ProviderMeta(props: { icon?: JSX.Element; label: string }) {
  return (
    <span class="flex items-center gap-1 text-xs text-ink-extra-muted">
      from
      <Show when={props.icon}>
        <span class="flex size-3.5 items-center justify-center [&_svg]:size-3.5">
          {props.icon}
        </span>
      </Show>
      {props.label}
    </span>
  );
}

/** Wrapping row of narrow pills. */
export function PillGrid(props: { children: JSX.Element }) {
  return <div class="flex flex-wrap gap-1.5">{props.children}</div>;
}

/**
 * A narrow, content-fit pill for one importable item, whose content reads
 * like an inline @ mention: entity icon, optional muted identifier, the name
 * with the mention underline, then trailing status icons. Width hugs the
 * content (name truncated past a cap) so a section reads as a compact cloud
 * instead of a full-width list. When `onToggle` is set the pill is
 * selectable; selected pills read as quietly active, deselected ones as
 * dimmed.
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
  selected?: boolean;
  onToggle?: () => void;
  /**
   * The Macro entity this item already became (imported by the user or a
   * teammate). Renders as a quiet "already in your workspace" pill that
   * opens the existing entity instead of a selectable import candidate.
   */
  importedHref?: string;
}) {
  const imported = () => props.importedHref !== undefined;
  const selectable = () => !imported() && props.onToggle !== undefined;
  const handleClick = () => {
    if (props.importedHref) {
      window.open(props.importedHref, '_blank');
    } else {
      props.onToggle?.();
    }
  };
  return (
    <button
      type="button"
      title={
        imported()
          ? 'Already in your workspace — click to open'
          : (props.title ?? props.label)
      }
      tabIndex={selectable() || imported() ? 0 : -1}
      onClick={handleClick}
      class={cn(
        'inline-flex h-7 max-w-72 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]',
        'cursor-default transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
        !selectable() && !imported() && 'pointer-events-auto',
        imported()
          ? 'border-ink/5 bg-ink/[0.03] text-ink-extra-muted hover:text-ink-muted'
          : props.selected || !selectable()
            ? 'border-ink/10 bg-surface text-ink'
            : 'border-ink/5 bg-transparent text-ink-extra-muted hover:border-ink/10 hover:text-ink-muted'
      )}
    >
      <Show when={props.icon}>
        <span
          class={cn(
            'flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5',
            !imported() && (props.selected || !selectable())
              ? 'opacity-90'
              : 'opacity-50'
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
      <Show when={imported()}>
        <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
          <CheckIcon class="size-3 shrink-0" />
          in Macro
        </span>
      </Show>
      <Show when={selectable() && props.selected}>
        <CheckIcon class="size-3 shrink-0 text-success" />
      </Show>
    </button>
  );
}

const SKELETON_WIDTHS = [88, 128, 72, 148, 104, 80, 136, 96];

/** Shimmering placeholder pills while a gather job runs. */
export function SkeletonPills(props: { count?: number }) {
  return (
    <div class="flex flex-wrap gap-1.5">
      <For each={SKELETON_WIDTHS.slice(0, props.count ?? 6)}>
        {(width) => (
          <span
            class="h-7 animate-pulse rounded-lg bg-ink/5"
            style={{ width: `${width}px` }}
          />
        )}
      </For>
    </div>
  );
}

/** Inline failure note with a retry affordance. */
export function FailureNote(props: { message?: string; onRetry: () => void }) {
  return (
    <div class="flex items-center gap-3 text-sm">
      <span class="min-w-0 truncate text-ink-muted">
        {props.message ?? "Something went wrong — this one's on us."}
      </span>
      <button
        type="button"
        class="shrink-0 font-medium text-ink-muted hover:text-ink"
        onClick={() => props.onRetry()}
      >
        Retry
      </button>
    </div>
  );
}

/** Quiet text button used for section-level actions (import, select all). */
export function QuietAction(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      class="text-xs text-ink-extra-muted transition-colors hover:text-ink-muted disabled:opacity-50"
      onClick={() => props.onClick()}
    >
      {props.label}
    </button>
  );
}
