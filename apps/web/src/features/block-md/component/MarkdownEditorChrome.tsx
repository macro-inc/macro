import { ENABLE_MARKDOWN_AI_GENERATE } from '@core/constant/featureFlags';
import { type JSX, Show } from 'solid-js';
import { EditorSystemMessage } from './EditorSystemMessage';

function getBlankMarkdownPlaceholder(canEdit: boolean) {
  if (!canEdit) return 'This document is blank...';
  const hints = [
    "'/' for commands",
    "'@' to reference files",
    "';' for snippets",
  ];
  if (ENABLE_MARKDOWN_AI_GENERATE) hints.push("'space' for AI writing");
  return `Press ${hints.join(', ')}...`;
}

/** Document body chrome shared by both editing engines. */
export function MarkdownEditorChrome(props: {
  ready: boolean;
  empty: boolean;
  canEdit: boolean;
  error?: string;
  connectContainer?: (element: HTMLDivElement) => void;
  body: JSX.Element;
  focusTarget: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <>
      <Show when={props.error}>
        {(error) => (
          <EditorSystemMessage variant="warning" class="mb-2">
            {error()}
          </EditorSystemMessage>
        )}
      </Show>
      {/* Preserve markdown node margin tops; avoid padding and borders here. */}
      <div class="relative mt-1.5 text-base" ref={props.connectContainer}>
        {props.body}
        {props.focusTarget}
        <Show when={!props.ready && !props.error}>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2.5 pt-1"
          >
            <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-2.5 w-2/3 rounded-full bg-skeleton" />
          </div>
        </Show>
        <Show when={props.ready && props.empty}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            {getBlankMarkdownPlaceholder(props.canEdit)}
          </div>
        </Show>
        {props.children}
      </div>
    </>
  );
}
