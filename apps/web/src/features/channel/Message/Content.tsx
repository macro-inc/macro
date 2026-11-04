import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { isEmojiOnly } from '@core/util/string';
import CaretRight from '@icon/system/regular/caret-right.svg';
import { isBotSenderId } from '@queries/messages/message-sender';
import { Button, cn } from '@ui';
import type { EditorState } from 'lexical';
import {
  type Accessor,
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
import { LinkPreviews } from './LinkPreviews';
import { getLinkPreviewUrls } from './link-previews';
import { MentionedImages } from './MentionedImages';
import { MentionedRoutineTemplates } from './MentionedRoutineTemplates';

// Height (px) a long body is cut to while collapsed.
const COLLAPSED_MAX_HEIGHT = 240;
// Collapse only when that hides a few lines or more, never just the last one.
const COLLAPSE_THRESHOLD = COLLAPSED_MAX_HEIGHT + 64;
const FADE_HEIGHT = 32;
const FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${FADE_HEIGHT}px), transparent 100%)`;

/** The element under `<body>` that holds `el`: the app, or the portal it renders in. */
function appRootOf(el: Element): Element {
  let root = el;
  while (root.parentElement && root.parentElement !== el.ownerDocument.body) {
    root = root.parentElement;
  }
  return root;
}

function pressTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/**
 * A press on the card, the badge that opens a minimized card, or a menu the
 * card portaled outside the app is still part of reading the comment.
 */
function pressKeepsExpandedComment(
  card: Element,
  target: EventTarget | null
): boolean {
  const element = pressTarget(target);
  if (!element) return true;
  if (card.contains(element)) return true;
  const badge = element.closest('[data-comment-badge]');
  if (badge) {
    const badgeThread = badge.getAttribute('data-comment-badge');
    const cardThread = card.getAttribute('data-comment-thread');
    // A badge with no thread id belongs to the card that is open beside it.
    if (!badgeThread || badgeThread === cardThread) return true;
  }
  return !appRootOf(card).contains(element);
}

type ContentProps = {
  class?: string;
  /** Show cards previewing the web pages the message links to. */
  linkPreviews?: boolean;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const termsLookup = useSearchHighlightTermsLookup();
  const collapseLongContent = useCollapseLongContent();

  // The body only: an agent message's leading session node is chrome the
  // sender line renders (`Message.AgentSessionLink`), not part of the text.
  const content = createMemo(() => splitMessageContent(message()).body);
  const bigEmoji = createMemo(() => isEmojiOnly(content()));
  // An agent's references stand out from its text, as in its session view.
  const fromAgent = () => isBotSenderId(message().sender_id);
  const terms = createMemo(() => termsLookup?.(message().id));

  const [markdownRoot, setMarkdownRoot] = createSignal<HTMLDivElement>();
  const [markdownState, setMarkdownState] =
    createSignal<Accessor<EditorState | null>>();
  // Read from the rendered parse, so a card follows exactly the links the
  // text shows (not ones in code, or links the author removed).
  const linkPreviewUrls = createMemo(() => {
    if (!props.linkPreviews) return [];
    const state = markdownState()?.();
    return state ? getLinkPreviewUrls(state) : [];
  });

  createSearchHighlightOverlay({ root: markdownRoot, content, terms });

  const body = () => (
    <>
      <StaticMarkdown
        markdown={content()}
        theme={channelTheme}
        target="internal"
        rootRef={setMarkdownRoot}
        setStateRef={(state) => setMarkdownState(() => state)}
      />
      <MentionedImages content={content()} />
      <MentionedRoutineTemplates content={content()} />
      <LinkPreviews urls={linkPreviewUrls()} />
    </>
  );

  return (
    <Show when={content()}>
      <div
        data-message-content
        class={cn(
          'whitespace-pre-wrap wrap-break-word max-w-full',
          bigEmoji() ? 'text-4xl' : 'text-base',
          fromAgent() && '[&_[data-mention]]:text-accent',
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
  let bodyRef!: HTMLDivElement;

  const showLess = () => {
    // The preview starts at the top, wherever the expanded body was scrolled.
    bodyRef.scrollTop = 0;
    setExpanded(false);
  };

  onMount(() => {
    // The unclamped inner box keeps its full height, so it reports growth
    // (images loading, edits) even while the preview is cut.
    const measure = () =>
      setOverflowing(measureRef.offsetHeight > COLLAPSE_THRESHOLD);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measureRef);
    // The margin card stays mounted when a press leaves it, so the body has
    // to fold itself. Folding on pointerdown would shrink this card and slide
    // the cards below it out from under the press before pointerup.
    let finishPress: ((event: PointerEvent) => void) | undefined;
    const clearFinish = () => {
      if (!finishPress) return;
      document.removeEventListener('pointerup', finishPress, true);
      document.removeEventListener('pointercancel', finishPress, true);
      finishPress = undefined;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!expanded()) return;
      const card = bodyRef.closest('[data-comment-thread]');
      if (!card || pressKeepsExpandedComment(card, event.target)) return;
      clearFinish();
      const pointerId = event.pointerId;
      finishPress = (end: PointerEvent) => {
        // A second pointer ending first must not fold the card under the first.
        if (end.pointerId !== pointerId) return;
        clearFinish();
        if (!expanded()) return;
        showLess();
      };
      document.addEventListener('pointerup', finishPress, true);
      document.addEventListener('pointercancel', finishPress, true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      clearFinish();
    });
  });

  const collapsed = () => overflowing() && !expanded();

  const toggleExpanded = () => {
    if (expanded()) showLess();
    else setExpanded(true);
  };

  return (
    <>
      <div
        ref={bodyRef}
        data-collapsed={collapsed() ? '' : undefined}
        // Expanded, the body scrolls inside the card, which would otherwise
        // grow past the document it sits beside.
        class={cn(
          collapsed() && 'overflow-hidden',
          expanded() && 'max-h-[50vh] overflow-y-auto'
        )}
        // Safari never focuses a scroll box on its own, so without this a
        // keyboard could not scroll a comment that has no links.
        tabIndex={expanded() ? 0 : undefined}
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
          onClick={toggleExpanded}
        >
          <CaretRight
            aria-hidden="true"
            class="transition-transform size-3 touch:size-6 shrink-0 pointer-events-none"
            classList={{ 'rotate-90': expanded() }}
          />
          {expanded() ? 'Show less' : 'Show more'}
        </Button>
      </Show>
    </>
  );
}
