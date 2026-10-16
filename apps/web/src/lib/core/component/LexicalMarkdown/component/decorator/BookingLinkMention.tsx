import { HoverCard } from '@core/component/HoverCard';
import { openExternalUrl } from '@core/util/url';
import { useNativeSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  $isBookingLinkMentionNode,
  type BookingLinkMentionDecoratorProps,
  HISTORIC_TAG,
  parseBookingUrl,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from '@macro-inc/lexical-core';
import OpenIcon from '@phosphor/arrows-out.svg';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import { cn, Surface } from '@ui';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createEffect, createMemo, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

function BookingLinkIcon(props: { class?: string }) {
  return <CalendarBlank class={cn('size-full text-accent', props.class)} />;
}

function fallbackLabel(props: BookingLinkMentionDecoratorProps): string {
  if (props.label) return props.label;
  if (props.slug) return props.slug;
  const parsed = parseBookingUrl(props.url);
  if (parsed?.slug) return parsed.slug;
  return 'Booking link';
}

function BookingLinkPreviewCard(props: {
  label: string;
  url: string;
  profileId: string;
  slug?: string;
}) {
  return (
    <div class="select-none w-72 text-ink">
      <Surface depth={3} class="glass bg-menu-glass rounded-xl">
        <div class="w-full flex flex-col">
          <div class="flex items-center justify-between gap-2 p-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="relative size-4 shrink-0 inline-flex">
                <BookingLinkIcon />
              </span>
              <span class="text-sm font-semibold truncate">{props.label}</span>
            </div>
            <a
              href={props.url}
              target="_blank"
              rel="noreferrer"
              class="shrink-0 text-link hover:text-link-hover visited:text-link-visited"
              onClick={(e) => e.stopPropagation()}
            >
              <OpenIcon class="size-4" />
            </a>
          </div>
          <Show when={props.slug}>
            <div class="px-2 pb-2 text-xs text-ink-muted truncate">
              /{props.slug}
            </div>
          </Show>
        </div>
      </Surface>
    </div>
  );
}

function BookingLinkMentionContent(props: BookingLinkMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;

  const label = createMemo(() => fallbackLabel(props));

  createEffect(() => {
    const nextLabel = label();
    const labelChanged = !!nextLabel && nextLabel !== props.label;
    if (!editor || !labelChanged) return;

    editor.update(
      () => {
        const node = $getNodeByKey(props.key);
        if ($isBookingLinkMentionNode(node)) {
          node.setLabel(nextLabel);
        }
      },
      {
        tag: [HISTORIC_TAG, SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG],
        discrete: true,
      }
    );
  });

  return (
    <span
      data-booking-link-mention="true"
      data-booking-profile-id={props.profileId}
      data-booking-label={label()}
      class="pointer-events-auto inline-flex max-w-[min(20em,100%)] items-baseline"
    >
      <span class="relative top-[0.125em] size-[1em] shrink-0 inline-flex mx-1">
        <BookingLinkIcon />
      </span>
      <span class="flex min-w-0 items-baseline underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        <span class="min-w-0 truncate">{label()}</span>
        <Show when={props.slug && label() !== props.slug}>
          <span class="shrink-0 whitespace-pre text-ink-extra-muted text-[0.8em]">
            {` /${props.slug}`}
          </span>
        </Show>
      </span>
    </span>
  );
}

export function BookingLinkMention(props: BookingLinkMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  // Booking pages are full-page public routes outside the split layout, so
  // open the shareable URL the same way an unsynced PR falls back to GitHub.
  const open = (_e: MouseEvent | KeyboardEvent | null) => {
    openExternalUrl(props.url);
  };

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          if (isSelectedAsNode()) {
            open(e);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  const navHandlers = useNativeSplitNavigationHandler<HTMLSpanElement>((e) => {
    e.stopPropagation();
    open(e);
  });

  return (
    <HoverCard
      trigger={
        <span class="relative">
          <span
            class={cn(
              'size-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active',
              isSelectedAsNode() && 'bg-active text-ink'
            )}
            {...navHandlers}
          >
            <BookingLinkMentionContent {...props} />
          </span>
          <MentionTooltip show={isSelectedAsNode()} text="Open" />
        </span>
      }
      content={
        <BookingLinkPreviewCard
          label={fallbackLabel(props)}
          url={props.url}
          profileId={props.profileId}
          slug={props.slug}
        />
      }
    />
  );
}
