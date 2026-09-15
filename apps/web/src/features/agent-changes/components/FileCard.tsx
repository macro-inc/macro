import { DiffChanges } from '@app/features/block-agent/ui/DiffChanges';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { splitPath } from '../core/changeset';
import type { FileDiffEntry } from '../core/patch';
import { StatusLetter } from './StatusLetter';

/** Plain note shown in place of a diff body. */
export function DiffNote(props: { children: JSX.Element }) {
  return (
    <div class="px-3 py-2.5 font-mono text-xs text-ink-placeholder">
      {props.children}
    </div>
  );
}

/**
 * One file in the stack: a sticky header with the review controls, and the
 * diff (or a note about why there is none) beneath it.
 */
export function FileCard(props: {
  entry: FileDiffEntry;
  collapsed: boolean;
  viewed: boolean;
  /** Briefly highlighted after the tree jumped here. */
  flash: boolean;
  onToggleCollapsed: () => void;
  onToggleViewed: () => void;
  onCopyPath: () => void;
  /** The diff body, supplied by the view so this card stays presentational. */
  body: JSX.Element;
  ref?: (element: HTMLElement) => void;
}) {
  const file = () => props.entry.file;
  const path = () => splitPath(file().path);
  const hidden = () =>
    `${file().additions} ${file().additions === 1 ? 'addition' : 'additions'}, ${file().deletions} ${file().deletions === 1 ? 'deletion' : 'deletions'} hidden`;
  return (
    <article
      ref={props.ref}
      class={cn(
        'scroll-mt-2 overflow-hidden rounded-lg bg-surface shadow-[inset_0_0_0_1px_var(--color-edge-muted)] transition-shadow',
        props.flash &&
          'shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-selected)]'
      )}
      data-path={file().path}
    >
      <header
        class={cn(
          'sticky top-0 z-5 flex min-h-8.5 items-center gap-2 border-b border-edge-muted bg-surface-1 pr-2',
          props.viewed && 'opacity-55'
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          class="ml-1"
          aria-expanded={!props.collapsed}
          aria-label={`${props.collapsed ? 'Show' : 'Hide'} ${path().base}`}
          tooltip={props.collapsed ? 'Show this diff' : 'Hide this diff'}
          onClick={() => props.onToggleCollapsed()}
        >
          <CaretRightIcon
            class={cn(
              'transition-transform duration-100 motion-reduce:transition-none',
              !props.collapsed && 'rotate-90'
            )}
          />
        </Button>
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left text-ink-muted hover:text-ink"
          aria-expanded={!props.collapsed}
          title={file().path}
          onClick={() => props.onToggleCollapsed()}
        >
          <StatusLetter kind={file().kind} />
          <span class="flex min-w-0 items-baseline font-mono text-[11.5px]">
            <Show when={file().previousPath}>
              {(previous) => (
                <span class="truncate text-ink-placeholder">
                  {previous()}
                  <span class="px-1">→</span>
                </span>
              )}
            </Show>
            <span class="min-w-0 shrink truncate text-ink-placeholder">
              {path().dir}
            </span>
            <span class="shrink-0 font-medium text-ink">{path().base}</span>
          </span>
        </button>
        <span class="flex shrink-0 items-center gap-2 text-[11px]">
          <DiffChanges
            variant="bars"
            additions={file().additions}
            deletions={file().deletions}
            class="max-sm:hidden"
          />
          <DiffChanges
            additions={file().additions}
            deletions={file().deletions}
          />
        </span>
        <button
          type="button"
          class={cn(
            'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border py-0 pr-2 pl-1 text-[11px] font-medium whitespace-nowrap',
            props.viewed
              ? 'border-success/45 bg-success/15 text-success'
              : 'border-edge text-ink-placeholder hover:bg-hover hover:text-ink-muted'
          )}
          aria-pressed={props.viewed}
          title={
            props.viewed
              ? 'Mark as not viewed. Reopens the diff.'
              : 'Mark as viewed. Collapses the diff.'
          }
          onClick={() => props.onToggleViewed()}
        >
          <span
            class={cn(
              'grid size-3.5 place-items-center rounded border',
              props.viewed
                ? 'border-transparent bg-success text-accent-contrast'
                : 'border-edge text-transparent'
            )}
          >
            <CheckIcon class="size-2.5" />
          </span>
          Viewed
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Copy path"
          onClick={() => props.onCopyPath()}
        >
          <CopyIcon />
        </Button>
      </header>
      <Show
        when={!props.collapsed}
        fallback={
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[11.5px] text-ink-placeholder hover:bg-hover hover:text-ink-muted"
            onClick={() => props.onToggleCollapsed()}
          >
            <CaretRightIcon class="size-3" />
            <span class="font-sans font-medium text-ink-muted">
              {props.entry.note ? 'Show' : 'Show diff'}
            </span>
            <span class="flex-1">{props.entry.note ?? hidden()}</span>
          </button>
        }
      >
        <Show
          when={!props.entry.note}
          fallback={<DiffNote>{props.entry.note}</DiffNote>}
        >
          {props.body}
        </Show>
      </Show>
    </article>
  );
}
