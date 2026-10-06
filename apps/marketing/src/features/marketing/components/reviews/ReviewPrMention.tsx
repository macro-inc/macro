import OpenIcon from '@phosphor/arrows-out.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { PrIcon, prRef } from './ReviewPullRequest';
import {
  type DemoPullRequest,
  type PrStatus,
  prCommentCount,
} from './review-fixtures';

const CHIP_CLASS: Record<PrStatus, string> = {
  open: 'bg-success/15 text-success',
  merged: 'bg-note/15 text-note',
  closed: 'bg-failure/15 text-failure',
};

/**
 * PullRequestMention's face inside markdown: status icon, title, and a muted
 * `#N`. Hover or focus shows the preview card; activating it opens the PR.
 */
export function PrMention(props: {
  pr: DemoPullRequest;
  status: PrStatus;
  hovered?: boolean;
  onHover?: (hovered: boolean, event: MouseEvent | FocusEvent) => void;
  onOpen?: () => void;
  ref?: (element: HTMLSpanElement) => void;
}) {
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    props.onOpen?.();
  };
  return (
    <span
      ref={props.ref}
      class="review-pr-mention"
      data-pr-mention="true"
      data-status={props.status}
      data-hovered={props.hovered ? 'true' : undefined}
      role="link"
      tabIndex={0}
      aria-label={`${props.pr.title} #${props.pr.number}`}
      onMouseEnter={(event) => props.onHover?.(true, event)}
      onMouseLeave={(event) => props.onHover?.(false, event)}
      onFocus={(event) => props.onHover?.(true, event)}
      onBlur={(event) => props.onHover?.(false, event)}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open(event);
      }}
    >
      <span class="review-pr-mention-icon">
        <PrIcon status={props.status} class="size-full" />
      </span>
      <span class="review-pr-mention-label">
        {props.pr.title}
        <span class="text-ink-extra-muted text-[0.8em]">{` #${props.pr.number}`}</span>
      </span>
    </span>
  );
}

function Stat(props: { class?: string; children: JSX.Element }) {
  return (
    <span class={cn('flex items-center gap-1 font-mono', props.class)}>
      {props.children}
    </span>
  );
}

/** PullRequestPreviewCard: ref, status chip, title, then size, comments, checks. */
export function PrPreviewCard(props: {
  pr: DemoPullRequest;
  status: PrStatus;
  class?: string;
  style?: JSX.CSSProperties;
  onHover?: (hovered: boolean, event: MouseEvent) => void;
}) {
  return (
    <div
      class={cn('review-pr-card', props.class)}
      style={props.style}
      role="dialog"
      aria-label={`Preview of ${prRef(props.pr)}`}
      onMouseEnter={(event) => props.onHover?.(true, event)}
      onMouseLeave={(event) => props.onHover?.(false, event)}
    >
      <div class="flex items-center justify-between gap-2 p-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="relative inline-flex size-4 shrink-0">
            <PrIcon status={props.status} class="size-full" />
          </span>
          <span class="truncate font-mono text-[0.8em] text-ink-muted">
            {prRef(props.pr)}
          </span>
          <span
            class={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-xxs font-medium uppercase tracking-wide',
              CHIP_CLASS[props.status]
            )}
          >
            {props.status}
          </span>
        </div>
        <span class="shrink-0 text-link" aria-hidden="true">
          <OpenIcon class="size-4" />
        </span>
      </div>
      <div class="mb-2 line-clamp-2 px-2 text-sm font-semibold">
        {props.pr.title}
      </div>
      <div class="flex items-center gap-3 border-t border-edge-muted p-2 text-xs text-ink-muted">
        <Stat>
          <span class="text-success">{`+${props.pr.additions}`}</span>
          <span class="text-failure">{`-${props.pr.deletions}`}</span>
        </Stat>
        <Stat>
          <ChatCircle class="size-3.5" />
          {prCommentCount(props.pr)}
        </Stat>
        <Stat class="ml-auto">
          <span class="text-success">{`${props.pr.checksPassed} passed`}</span>
        </Stat>
      </div>
    </div>
  );
}
