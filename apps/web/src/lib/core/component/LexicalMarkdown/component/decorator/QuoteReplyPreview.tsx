import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The quote-reply row shared by every "this refers to that" chip: the elbow
 * connector, a bold label, and a single clipped line of the quoted text.
 * Channel reply targets and agent-session referenced text render through
 * this so they read identically. The preview never shows more than one
 * line; whatever the chip refers to stays behind `onClick`.
 */
export function QuoteReplyPreview(props: {
  /** Who or what is being replied to, e.g. the sender's name. */
  label: JSX.Element;
  /** Markdown of the quoted text; rendered as one clipped line. */
  text: string;
  ariaLabel: string;
  onClick: (event: MouseEvent) => void;
  /**
   * Actions shown to the right of the preview, e.g. an edit menu. Kept
   * outside the button so it can hold its own controls.
   */
  trailing?: JSX.Element;
  class?: string;
  /** `data-*` hooks for the button, e.g. the id of the referenced message. */
  buttonAttrs?: Record<`data-${string}`, string | undefined>;
}) {
  return (
    <div
      class={cn(
        'group/reply-target flex w-full min-w-0 items-center rounded-md hover:bg-hover',
        props.class
      )}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs text-ink-muted"
        aria-label={props.ariaLabel}
        on:mousedown={(event) => event.preventDefault()}
        on:click={props.onClick}
        {...props.buttonAttrs}
      >
        <svg
          viewBox="0 0 20 21.333"
          class="ml-1 h-[1.333rem] w-5 shrink-0 overflow-visible text-edge transition-opacity group-hover/reply-target:opacity-0"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M20 10.667H8a8 5.333 0 0 0-8 5.333v5.333"
            stroke="currentColor"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span class="shrink-0 font-semibold text-ink-disabled transition-colors group-hover/reply-target:text-ink-subtle">
          {props.label}
        </span>
        <div class="min-w-0 flex-1 overflow-hidden italic text-ink-subtle transition-colors group-hover/reply-target:text-ink-muted">
          <StaticMarkdown
            markdown={props.text}
            theme={singleLineMarkdownTheme}
            target="internal"
            singleLine
          />
        </div>
      </button>
      {props.trailing}
    </div>
  );
}
