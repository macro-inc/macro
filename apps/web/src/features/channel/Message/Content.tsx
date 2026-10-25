import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { isEmojiOnly } from '@core/util/string';
import CaretRight from '@phosphor/caret-right.svg';
import { Button, cn } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import {
  useCollapseLongContent,
  useMessage,
  useSearchHighlightTermsLookup,
} from './context';
import { createSearchHighlightOverlay } from './highlightOverlay';
import { MentionedImages } from './MentionedImages';

// Height (px) a long body is cut to while collapsed.
const COLLAPSED_MAX_HEIGHT = 240;
// Collapse only when that hides a few lines or more, never just the last one.
const COLLAPSE_THRESHOLD = COLLAPSED_MAX_HEIGHT + 64;
const FADE_HEIGHT = 32;
const FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${FADE_HEIGHT}px), transparent 100%)`;

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const termsLookup = useSearchHighlightTermsLookup();
  const collapseLongContent = useCollapseLongContent();

  // The body only: an agent message's leading session node is chrome the
  // sender line renders (`Message.AgentSessionLink`), not part of the text.
  const content = createMemo(() => splitMessageContent(message()).body);
  const bigEmoji = createMemo(() => isEmojiOnly(content()));
  const terms = createMemo(() => termsLookup?.(message().id));

  const [markdownRoot, setMarkdownRoot] = createSignal<HTMLDivElement>();

  createSearchHighlightOverlay({ root: markdownRoot, content, terms });

  const body = () => (
    <>
      <StaticMarkdown
        markdown={content()}
        theme={channelTheme}
        target="internal"
        rootRef={setMarkdownRoot}
      />
      <MentionedImages content={content()} />
    </>
  );

  return (
    <Show when={content()}>
      <div
        data-message-content
        class={cn(
          'whitespace-pre-wrap wrap-break-word max-w-full',
          bigEmoji() ? 'text-4xl' : 'text-base',
          props.class
        )}
      >
        <Show when={collapseLongContent} fallback={body()}>
          <CollapsibleBody>{body()}</CollapsibleBody>
        </Show>
      </div>
    </Show>
  );
}

/** Cuts a long body to a faded preview with a "Show more" / "Show less" toggle. */
function CollapsibleBody(props: { children: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let measureRef!: HTMLDivElement;

  onMount(() => {
    // The unclamped inner box keeps its full height, so it reports growth
    // (images loading, edits) even while the preview is cut.
    const measure = () =>
      setOverflowing(measureRef.offsetHeight > COLLAPSE_THRESHOLD);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measureRef);
    onCleanup(() => observer.disconnect());
  });

  const collapsed = () => overflowing() && !expanded();

  return (
    <>
      <div
        data-collapsed={collapsed() ? '' : undefined}
        class={cn(collapsed() && 'overflow-hidden')}
        // Tabbing to a link under the cut (or in the fade) reveals it
        // instead of focusing something hidden.
        onFocusIn={(event) => {
          if (!collapsed() || !(event.target instanceof Element)) return;
          const cut = event.currentTarget.getBoundingClientRect().bottom;
          const target = event.target.getBoundingClientRect().bottom;
          if (target > cut - FADE_HEIGHT) setExpanded(true);
        }}
        style={
          collapsed()
            ? {
                'max-height': `${COLLAPSED_MAX_HEIGHT}px`,
                'mask-image': FADE_MASK,
                '-webkit-mask-image': FADE_MASK,
              }
            : undefined
        }
      >
        <div ref={measureRef}>{props.children}</div>
      </div>
      <Show when={overflowing()}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="mt-1 -ml-1.5 text-ink-muted"
          aria-expanded={expanded()}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <CaretRight
            aria-hidden="true"
            class="transition-transform"
            classList={{ 'rotate-90': expanded() }}
          />
          {expanded() ? 'Show less' : 'Show more'}
        </Button>
      </Show>
    </>
  );
}
