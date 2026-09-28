import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import {
  parseMacroAppLink,
  sanitizeCalendarDescription,
} from '@app/features/calendar/utils/calendar-description';
import {
  type CalendarMentionTarget,
  copyCalendarEventMentionTarget,
} from '@app/features/calendar-view/copy-event-mention';
import { calendarMentionOpen } from '@app/features/calendar-view/mention-open-target';
import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { openChatWithAgent } from '@app/features/chat/ChatWithAgentButton';
import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS as URL_PARAMS_CANVAS } from '@block-canvas/constants';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as URL_PARAMS_MD } from '@block-md/constants';
import { URL_PARAMS as URL_PARAMS_PDF } from '@block-pdf/constants';
import {
  type BlockAlias,
  type BlockName,
  useMaybeBlockName,
} from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { useHoldParentHoverCardOpen } from '@core/component/HoverCard';
import {
  isBlockNameWithLocation,
  openDocument as openBlockDocument,
} from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { toast } from '@core/component/Toast/Toast';
import { itemToBlockName, resolveBlockAlias } from '@core/constant/allBlocks';
import { getDisplayName, tryMacroId } from '@core/user';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { matches } from '@core/util/match';
import { openExternalUrl } from '@core/util/url';
import MacroEmbed from '@icon/macro-embed.svg';
import CollapseInlinePreview from '@phosphor/arrows-in-line-horizontal.svg';
import ExpandInlinePreview from '@phosphor/arrows-out-line-horizontal.svg';
import MessageIcon from '@phosphor/chat-circle.svg';
import ThreadIcon from '@phosphor/chats-circle.svg';
import ClockIcon from '@phosphor/clock.svg';
import ColumnsPlusRight from '@phosphor/columns-plus-right.svg';
import DotsThree from '@phosphor/dots-three.svg';
import EyeIcon from '@phosphor/eye.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import HighlightIcon from '@phosphor/highlighter-circle.svg';
import Link from '@phosphor/link.svg';
import MapPinIcon from '@phosphor/map-pin-simple.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import TextAlignLeftIcon from '@phosphor/text-align-left.svg';
import TrashSimple from '@phosphor/trash-simple.svg';
import UsersIcon from '@phosphor/users.svg';
import {
  isAccessiblePreviewItem,
  isCalendarEventPreviewItem,
  isChannelPreviewItem,
  isPreviewItemNoAccess,
  type PreviewCalendarEventAccess,
} from '@queries/preview';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { blockNameToItemType } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { Card, cn, Dropdown, Item } from '@ui';
import type { Component, JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { formatDate } from '../util/date';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { useItemPreviewData } from './ItemPreview';
import {
  TaskPropertiesPreview,
  TaskPropertiesPreviewProvider,
} from './TaskPropertiesPreview';

/**
 * Container for displaying mentions with optional collapsing
 */
function MentionContainer(props: {
  icon: JSX.Element;
  text: JSX.Element;
  collapsed?: boolean;
}) {
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        {props.icon}
      </span>
      <Show when={!props.collapsed}>
        <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 mr-1">
          {props.text}
        </span>
      </Show>
    </span>
  );
}

/**
 * Simple spinner component for loading states
 */
function Spinner() {
  return (
    <div class="animate-spin">
      <LoadingSpinner />
    </div>
  );
}

/**
 * Loading indicator for mentions
 */
function Loading() {
  return <MentionContainer icon={<Spinner />} text="Loading" />;
}

/**
 * Returns the appropriate icon component based on the icon name
 * @param icon - Icon identifier string
 * @returns JSX element for the icon or undefined
 */
export const getMentionsIcon = (icon: string | undefined) => {
  if (!icon) return;

  const iconClasses =
    'relative top-[-0.125em] size-4 inline-flex items-center mx-1';

  switch (icon) {
    case 'highlight':
      return <HighlightIcon class={iconClasses} />;
    case 'map-pin':
      return <MapPinIcon class={iconClasses} />;
    case 'message':
      return <MessageIcon class={iconClasses} />;
    case 'thread':
      return <ThreadIcon class={iconClasses} />;
    case 'text':
      return <MapPinIcon class={iconClasses} />;
    default:
      return;
  }
};

/**
 * Determines additional context information for mentions based on block type
 */
export const mentionsAccessories = (
  blockName: BlockName | BlockAlias,
  params: Record<string, string>
): { note?: string; icon?: string } | undefined => {
  if (!params) return undefined;

  // PDF block handling
  if (blockName === 'pdf') {
    const id = params[URL_PARAMS_PDF.annotationId];
    if (id?.trim()) {
      return { note: `Annotation: ${id}` };
    }

    const pageIndex = Number(params[URL_PARAMS_PDF.pageNumber]);
    const y = parseInt(params[URL_PARAMS_PDF.yPos], 10);
    const width = Number(params[URL_PARAMS_PDF.width]);
    const height = Number(params[URL_PARAMS_PDF.height]);

    if (!isNaN(pageIndex) && pageIndex > 0) {
      if (
        !isNaN(y) &&
        !isNaN(width) &&
        !isNaN(height) &&
        width > 0 &&
        height > 0
      ) {
        return { note: `Page ${pageIndex}`, icon: 'highlight' };
      }
      return { note: `Page ${pageIndex}` };
    }
  }
  // Canvas block handling
  else if (blockName === 'canvas') {
    const x = 0 - Number(params[URL_PARAMS_CANVAS.x]);
    const y = Number(params[URL_PARAMS_CANVAS.y]);
    if (!isNaN(x) && !isNaN(y)) {
      return { note: `(x: ${x},  y: ${y})`, icon: 'map-pin' };
    }
    return;
  }
  // Channel block handling
  else if (blockName === 'channel') {
    const threadId = params[CHANNEL_PARAMS.thread];
    const messageId = params[CHANNEL_PARAMS.message];
    if (threadId) {
      return {
        icon: 'thread',
        note: 'Thread',
      };
    } else if (messageId) {
      return { icon: 'message', note: 'Message' };
    }
    return;
  }
  // Md block handling
  else if (resolveBlockAlias(blockName) === 'md') {
    const id = params[URL_PARAMS_MD.nodeId];
    const loc = params[URL_PARAMS_MD.location];
    if (id?.trim() || loc?.trim()) {
      return { icon: 'highlight', note: 'Snippet' };
    }

    const comment = params[URL_PARAMS_MD.commentId];
    if (comment?.trim()) {
      return { icon: 'message', note: 'Comment' };
    }
  }
};

/**
 * Metadata info component with icon and text
 */
function MetadataInfo(props: {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  children: JSX.Element;
  align?: 'left' | 'right';
}) {
  return (
    <div
      class={cn(
        'flex',
        props.align === 'right' ? 'justify-end' : 'justify-start',
        'mt-2',
        props.align === 'left' && 'w-fit max-w-[66%]',
        'text-ink-muted',
        props.align === 'left' && 'truncate  '
      )}
    >
      <span class="relative text-[0.8em] text-ink-muted max-w-full flex items-center">
        <Dynamic component={props.icon} class="relative size-3 mx-1" />
        {props.children}
      </span>
    </div>
  );
}

/**
 * Popup preview component for document references
 */
function ImageCoverStrip(props: {
  documentId: string;
  fileType?: string;
  class?: string;
}) {
  const query = useBinaryDocumentQuery(() => props.documentId);

  // Captured once at mount: true means the spinner was shown and we should fade in.
  // Reading .isLoading (not .data) avoids triggering Suspense here.
  const shouldFadeIn = query.isLoading;

  // SVGs served from presigned URLs may not carry the correct Content-Type header
  // (especially for older uploads), which causes <img> to show a broken image.
  // Fetching as a blob and creating an object URL with an explicit MIME type
  // bypasses this, matching the approach used by the full image viewer.
  const [svgObjectUrl, setSvgObjectUrl] = createSignal<string | undefined>();
  createEffect(() => {
    const presignedUrl = query.data;
    if (!presignedUrl || props.fileType !== 'svg') return;

    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetchBinary(presignedUrl, 'blob', { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted || result.isErr()) return;
        const blob = result.value;
        objectUrl = URL.createObjectURL(
          new Blob([blob], { type: 'image/svg+xml' })
        );
        setSvgObjectUrl(objectUrl);
      }
    );

    onCleanup(() => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSvgObjectUrl(undefined);
    });
  });

  const displayUrl = () =>
    props.fileType === 'svg' ? svgObjectUrl() : query.data;

  return (
    <div
      class={cn(
        'w-full overflow-hidden relative bg-edge-muted',
        props.class ?? 'h-32'
      )}
    >
      <Suspense
        fallback={
          <div class="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner class="size-5 animate-spin text-ink-muted" />
          </div>
        }
      >
        <Show when={displayUrl()}>
          {(url) => (
            <img
              src={url()}
              class={cn(
                'absolute inset-0 size-full object-cover',
                shouldFadeIn && 'opacity-0 transition-opacity duration-300'
              )}
              onLoad={
                shouldFadeIn
                  ? (e) => {
                      const img = e.target as HTMLImageElement;
                      requestAnimationFrame(() => {
                        img.style.opacity = '1';
                      });
                    }
                  : undefined
              }
              alt=""
            />
          )}
        </Show>
      </Suspense>
    </div>
  );
}

const calendarDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const calendarTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** One compact local-time schedule line for a calendar mention preview. */
export function calendarPreviewSchedule(
  event: PreviewCalendarEventAccess['event']
): string | undefined {
  if (event.time.kind === 'allDay') {
    const start = parseLocalDate(event.time.startDate);
    if (!start) return undefined;
    const end = parseLocalDate(event.time.endDate);
    const inclusiveEnd = end ? new Date(end) : undefined;
    inclusiveEnd?.setDate(inclusiveEnd.getDate() - 1);
    return inclusiveEnd && inclusiveEnd > start
      ? `${calendarDateFormat.format(start)} – ${calendarDateFormat.format(inclusiveEnd)} · All day`
      : `${calendarDateFormat.format(start)} · All day`;
  }
  const start = new Date(event.time.startsAt);
  const end = new Date(event.time.endsAt);
  if (!Number.isFinite(start.getTime())) return undefined;
  if (!Number.isFinite(end.getTime())) {
    return `${calendarDateFormat.format(start)} · ${calendarTimeFormat.format(start)}`;
  }
  return start.toDateString() === end.toDateString()
    ? `${calendarDateFormat.format(start)} · ${calendarTimeFormat.format(start)} – ${calendarTimeFormat.format(end)}`
    : `${calendarDateFormat.format(start)}, ${calendarTimeFormat.format(start)} – ${calendarDateFormat.format(end)}, ${calendarTimeFormat.format(end)}`;
}

/** Meeting-level rows of the calendar mention hover card. */
function CalendarEventPreviewDetails(props: {
  event: PreviewCalendarEventAccess['event'];
}) {
  const organizer = () =>
    props.event.organizerName ?? props.event.organizerEmail;
  const descriptionHtml = () =>
    sanitizeCalendarDescription(props.event.description ?? '');
  // Opening a Macro link reads the split layout from context, so the handler
  // keeps this component's owner.
  const openDescriptionLink = createCallback((event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = parseMacroAppLink(anchor.href);
    if (target) {
      openBlockDocument(
        target.blockName,
        target.documentId,
        Object.fromEntries(new URL(anchor.href).searchParams),
        event.shiftKey
      );
      return;
    }
    openExternalUrl(anchor.href);
  });
  return (
    <div class="px-2 pb-2 flex flex-col gap-1 text-sm text-ink-muted">
      <Show when={!props.event.viewerEventId}>
        <MetadataInfo icon={EyeIcon}>
          Shared with you · not on your calendar
        </MetadataInfo>
      </Show>
      <Show when={calendarPreviewSchedule(props.event)}>
        {(schedule) => (
          <MetadataInfo icon={ClockIcon}>
            {schedule()}
            <Show when={props.event.isRecurring}> · Repeats</Show>
          </MetadataInfo>
        )}
      </Show>
      <Show when={props.event.location}>
        {(location) => (
          <MetadataInfo icon={MapPinIcon}>
            <span class="truncate">{location()}</span>
          </MetadataInfo>
        )}
      </Show>
      <Show when={descriptionHtml()}>
        {(html) => (
          <div class="mt-2 flex items-start text-[0.8em] text-ink-muted">
            <TextAlignLeftIcon class="relative mx-1 mt-0.5 size-3 shrink-0" />
            <div
              class="line-clamp-4 min-w-0 wrap-anywhere [&_a]:text-accent [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_p+p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
              innerHTML={html()}
              onClick={openDescriptionLink}
            />
          </div>
        )}
      </Show>
      <Show when={organizer() || props.event.attendeeCount > 0}>
        <MetadataInfo icon={UsersIcon}>
          <span class="truncate">
            <Show when={organizer()}>{(name) => <>{name()}</>}</Show>
            <Show when={organizer() && props.event.attendeeCount > 0}>
              {' · '}
            </Show>
            <Show when={props.event.attendeeCount > 0}>
              {props.event.attendeeCount}{' '}
              {props.event.attendeeCount === 1 ? 'attendee' : 'attendees'}
            </Show>
          </span>
        </MetadataInfo>
      </Show>
    </div>
  );
}

/**
 * Props for the reusable document-preview body. These are everything
 * {@link PopupPreview} needs EXCEPT the floating-hover-card concerns
 * (`mouseEnter` / `mouseLeave`), which only matter while the preview lives
 * inside a floating card.
 */
export type DocumentPreviewContentProps = {
  delete?: () => void;
  collapseInfo?: {
    isCollapsable: boolean;
    isCollapsed: boolean;
    handleCollapse: () => void;
  };
  documentInfo: {
    id: string;
    name?: string;
    type: BlockName | BlockAlias;
    params: Record<string, string>;
    isOpenable?: boolean;
  };
  previewInfo?: {
    showPreview: boolean;
    isPreviewable: boolean;
    handlePreviewToggle: () => void;
  };
  snapshotInfo?: {
    date: string;
    characterCount?: number;
  };
  useFallbackData?: boolean;
};

/**
 * The inner preview body shared by every document/task preview: the header
 * (icon + filename + action buttons), the task body
 * ({@link TaskPropertiesPreview}), the inset image preview, the author/update
 * byline, and the loading / no_access / does_not_exist states.
 *
 * It renders NO floating/highlighted chrome — no colored highlight border, no
 * shadow, no rounded floating shell. Wrap it in your own container to control
 * the surrounding appearance. {@link PopupPreview} wraps it in the floating
 * hover-card shell; other callers can wrap it in a normal border.
 */
export function DocumentPreviewContent(props: DocumentPreviewContentProps) {
  // Hooks
  const navigate = useNavigate();

  const blockName = useMaybeBlockName();
  const itemPreviewEntity = () => {
    const type = blockNameToItemType(props.documentInfo.type);
    let messageId: string | undefined;
    if (
      type === 'channel' &&
      CHANNEL_PARAMS.message in props.documentInfo.params
    ) {
      messageId = props.documentInfo.params[CHANNEL_PARAMS.message];
    }
    return { id: props.documentInfo.id, type, messageId };
  };

  const { item, ItemEntityIcon, documentProperties } =
    useItemPreviewData(itemPreviewEntity);

  const [menuOpen, setMenuOpen] = createSignal(false);
  useHoldParentHoverCardOpen(menuOpen);

  // Resolve the caller-provided type against the item's actual subType so
  // that e.g. a markdown doc with `subType: { type: 'task' }` routes to the
  // 'task' block alias instead of raw 'md'. Mirrors BlockLink/EntityMention.
  const targetBlockType = createMemo<BlockName | BlockAlias>(() => {
    const i = item();
    if (isAccessiblePreviewItem(i)) {
      return itemToBlockName(i);
    }
    return props.documentInfo.type;
  });

  // Derived state
  const canOpenInChat = createCallback(() => {
    if (blockName && ['chat'].includes(blockName)) {
      return false;
    }
    const validChatInputTypes = [
      'write',
      'pdf',
      'md',
      'code',
      'image',
      'canvas',
    ];
    return validChatInputTypes.includes(props.documentInfo.type);
  });

  // Handle collapse toggle
  const handleToggleCollapse = () => {
    props.collapseInfo?.handleCollapse();
  };

  // Calendar is a singleton application view: a mentioned event opens it aimed
  // at the viewer's own copy of the meeting rather than a per-id split. A
  // preview that is not (yet) accessible still routes the mentioned id through
  // the singleton opener so it resolves through the event preview API.
  const calendarOpen = () => {
    if (targetBlockType() !== 'calendar') return undefined;
    return calendarMentionOpen(
      item(),
      props.documentInfo.id,
      props.documentInfo.params?.occurrenceKey
    );
  };
  const calendarOpenTarget = () => {
    const open = calendarOpen();
    return open?.kind === 'calendar' ? open.target : undefined;
  };
  // A meeting shared through a channel but absent from the viewer's own
  // calendars previews read-only: there is no event of theirs to open.
  const isReadOnlyCalendarShare = () => calendarOpen()?.kind === 'read_only';
  const isOpenable = () =>
    !!props.documentInfo.isOpenable && !isReadOnlyCalendarShare();

  const openDocument = createCallback(async (event: MouseEvent) => {
    const calendarTarget = calendarOpenTarget();
    if (calendarTarget) {
      await openCalendarEventSplit({
        ...calendarTarget,
        openInNewSplit: event.shiftKey,
      });
      return;
    }
    const type = targetBlockType();
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.warn('No split manager found');
      let link = `/${type}/${props.documentInfo.id}`;
      if (props.documentInfo.params) {
        const queryParams = new URLSearchParams(
          props.documentInfo.params
        ).toString();
        link += `?${queryParams}`;
      }
      navigate(link);
      return;
    }

    if (event.shiftKey) {
      splitManager.openWithSplit(
        { type, id: props.documentInfo.id, params: props.documentInfo.params },
        { preferNewSplit: true }
      );
      return;
    }

    splitManager.replaceAllSplits({
      type,
      id: props.documentInfo.id,
      params: props.documentInfo.params,
    });
  });

  const handleOpenInChat = () => {
    const preview = item();
    void openChatWithAgent({
      type: 'document',
      id: props.documentInfo.id,
      name:
        (isAccessiblePreviewItem(preview) ? preview.name : undefined) ??
        props.documentInfo.name ??
        '',
      fileType: targetBlockType(),
    });
  };

  // Copying an event has to reproduce what the calendar's own copy action
  // writes, so pasting into an editor rebuilds the mention instead of
  // dropping in a bare deep link.
  const calendarMentionTarget = (): CalendarMentionTarget | undefined => {
    const open = calendarOpen();
    if (!open) return undefined;
    // A read-only share re-mentions the id that was shared with the channel.
    const target =
      open.kind === 'calendar'
        ? open.target
        : {
            eventId: props.documentInfo.id,
            occurrenceKey: props.documentInfo.params?.occurrenceKey,
          };
    const i = item();
    const previewed = isCalendarEventPreviewItem(i) ? i.event : undefined;
    return {
      eventId: target.eventId,
      // An untitled event still copies as a mention, under the same
      // '(No title)' label it carries everywhere else.
      title: previewed?.title || props.documentInfo.name || '(No title)',
      occurrenceKey:
        previewed && !previewed.isRecurring ? undefined : target.occurrenceKey,
    };
  };

  const handleCopy = () => {
    try {
      let hostname = window.location.hostname.replace('www.', '').toLowerCase();
      if (hostname === 'localhost') {
        hostname = 'dev.macro.com';
      }

      const mentionTarget = calendarMentionTarget();
      if (mentionTarget) {
        copyCalendarEventMentionTarget(mentionTarget);
        return;
      }

      let link = `https://${hostname}/app/${targetBlockType()}/${props.documentInfo.id}`;

      if (
        props.documentInfo.params &&
        Object.keys(props.documentInfo.params).length > 0
      ) {
        const queryParams = new URLSearchParams(
          props.documentInfo.params
        ).toString();
        link += `?${queryParams}`;
      }
      navigator.clipboard.writeText(link);
      toast.success('Copied document link to clipboard');
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyBranchName = () => {
    copyBranchNameToClipboard(props.documentInfo.id);
  };

  const isSplitAlreadyOpen = () => {
    const splitManager = globalSplitManager();
    if (!splitManager) return false;
    if (calendarOpenTarget()) {
      return !!splitManager.getSplitByContent('component', CALENDAR_VIEW_ID);
    }
    return !!splitManager.getSplitByContent(
      targetBlockType(),
      props.documentInfo.id
    );
  };

  const openInNewSplit = createCallback(async () => {
    const calendarTarget = calendarOpenTarget();
    if (calendarTarget) {
      await openCalendarEventSplit({ ...calendarTarget, openInNewSplit: true });
      return;
    }
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    const type = targetBlockType();
    const existing = splitManager.getSplitByContent(
      type,
      props.documentInfo.id
    );
    if (existing) {
      existing.activate();
    } else {
      splitManager.createNewSplit({
        content: {
          type,
          id: props.documentInfo.id,
          params: props.documentInfo.params,
        },
        referredFrom: null,
      });
    }

    if (!isBlockNameWithLocation(type)) return;

    const orchestrator = splitManager.getOrchestrator();
    const handle = await orchestrator.getBlockHandle(
      props.documentInfo.id,
      resolveBlockAlias(type)
    );

    await handle?.goToLocationFromParams(props.documentInfo.params);
  });

  const PreviewTitle = (local: { name: string }) => (
    <Item.Title>
      <Show
        when={isOpenable()}
        fallback={<span class="wrap-anywhere">{local.name}</span>}
      >
        <button
          type="button"
          class="min-w-0 text-left wrap-anywhere rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={(event) => {
            event.stopPropagation();
            void openDocument(event);
          }}
        >
          {local.name}
        </button>
      </Show>
    </Item.Title>
  );

  const renderActionButtons = () => (
    <Item.Actions
      class="col-start-3 row-start-1 h-5"
      onClick={(event) => event.stopPropagation()}
    >
      <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          size="icon-sm"
          variant="ghost"
          aria-label="Reference actions"
        >
          <DotsThree />
        </Dropdown.Trigger>
        <Dropdown.Content blockingBackdrop class="z-nested-action-menu">
          <Dropdown.Group>
            <Show when={props.previewInfo?.showPreview}>
              <Dropdown.Item
                onSelect={() => props.previewInfo?.handlePreviewToggle()}
              >
                <MacroEmbed class="size-4" />
                {props.previewInfo?.isPreviewable
                  ? 'Convert to Embed'
                  : 'Convert to Card View'}
              </Dropdown.Item>
            </Show>
            <Show when={props.collapseInfo?.isCollapsable}>
              <Dropdown.Item onSelect={handleToggleCollapse}>
                <Show
                  when={props.collapseInfo?.isCollapsed}
                  fallback={<CollapseInlinePreview class="size-4" />}
                >
                  <ExpandInlinePreview class="size-4" />
                </Show>
                {props.collapseInfo?.isCollapsed
                  ? 'Expand Reference'
                  : 'Collapse Reference'}
              </Dropdown.Item>
            </Show>
            <Show when={canOpenInChat()}>
              <Dropdown.Item onSelect={handleOpenInChat}>
                <SparkleIcon class="size-4" />
                Ask Macro
              </Dropdown.Item>
            </Show>
            <Dropdown.Item onSelect={handleCopy}>
              <Link class="size-4" />
              Copy Link
            </Dropdown.Item>
            <Show when={props.documentInfo.type === 'task'}>
              <Dropdown.Item onSelect={handleCopyBranchName}>
                <GitBranchIcon class="size-4" />
                Copy Branch Name
              </Dropdown.Item>
            </Show>
            <Show when={isOpenable() && !isSplitAlreadyOpen()}>
              <Dropdown.Item onSelect={() => void openInNewSplit()}>
                <ColumnsPlusRight class="size-4" />
                Open in New Split
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
          <Show when={props.delete}>
            <Dropdown.Group>
              <Dropdown.Item onSelect={() => props.delete?.()}>
                <TrashSimple class="size-4" />
                Delete
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Item.Actions>
  );

  return (
    <Switch>
      {/* Loading state */}
      <Match when={item().loading}>
        <div class="p-3 flex items-center justify-center">
          <Loading />
        </div>
      </Match>

      {/* Accessible preview */}
      <Match when={matches(item(), isAccessiblePreviewItem)}>
        {(accessibleItem) => {
          const accessories = () =>
            mentionsAccessories(
              props.documentInfo.type,
              props.documentInfo.params
            );
          const messageContext = () => {
            const item = accessibleItem();
            return isChannelPreviewItem(item) ? item.messageContext : undefined;
          };

          return (
            <TaskPropertiesPreviewProvider
              taskId={
                targetBlockType() === 'task' ? props.documentInfo.id : undefined
              }
              previewProperties={documentProperties()}
            >
              <div class="w-full flex flex-col">
                <Card.Header class="py-2.5">
                  <Item class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 border-0 p-0">
                    <Item.Icon class="col-start-1 row-start-1">
                      <Show
                        when={targetBlockType() === 'task'}
                        fallback={<ItemEntityIcon size="xs" />}
                      >
                        <Suspense
                          fallback={
                            <LoadingSpinner class="size-4 animate-spin text-ink-muted" />
                          }
                        >
                          <TaskPropertiesPreview
                            taskId={props.documentInfo.id}
                            taskName={accessibleItem().name}
                            previewProperties={documentProperties()}
                            mode="status"
                          />
                        </Suspense>
                      </Show>
                    </Item.Icon>
                    <Item.Content class="col-start-2 row-start-1">
                      <PreviewTitle
                        name={props.documentInfo.name || accessibleItem().name}
                      />
                      {/* A calendar card shows the event's own schedule; its
                          last-updated time would read as the meeting time. */}
                      <Show
                        when={
                          !isCalendarEventPreviewItem(accessibleItem()) &&
                          (messageContext()?.sender_id ||
                            accessibleItem().owner ||
                            messageContext()?.created_at ||
                            accessibleItem().updatedAt)
                        }
                      >
                        <Item.Description class="text-left wrap-anywhere">
                          <Show
                            when={
                              messageContext()?.sender_id ||
                              accessibleItem().owner
                            }
                          >
                            {(owner) =>
                              getDisplayName(tryMacroId(owner())) ||
                              owner().replace('macro|', '')
                            }
                          </Show>
                          <Show
                            when={
                              (messageContext()?.sender_id ||
                                accessibleItem().owner) &&
                              (messageContext()?.created_at ||
                                accessibleItem().updatedAt)
                            }
                          >
                            {' - '}
                          </Show>
                          <Show
                            when={
                              messageContext()?.created_at ||
                              accessibleItem().updatedAt
                            }
                          >
                            {(time) => formatDate(time())}
                          </Show>
                        </Item.Description>
                      </Show>
                      <Show when={accessories()}>
                        {(acc) => (
                          <Item.Metadata>
                            {acc().note}
                            {getMentionsIcon(acc().icon)}
                          </Item.Metadata>
                        )}
                      </Show>
                    </Item.Content>
                    {renderActionButtons()}
                  </Item>
                </Card.Header>

                {/* Status lives in the header; remaining properties align with the title. */}
                <Show when={targetBlockType() === 'task'}>
                  <Card.Body class="pt-2 pl-9 [&>div]:px-0 [&>div]:pb-0">
                    <Suspense
                      fallback={<div class="w-full bg-active h-4 m-2" />}
                    >
                      <TaskPropertiesPreview
                        taskId={props.documentInfo.id}
                        taskName={accessibleItem().name}
                        previewProperties={documentProperties()}
                        mode="details"
                      />
                    </Suspense>
                  </Card.Body>
                </Show>

                {/* Calendar event schedule, location, and people */}
                <Show when={matches(item(), isCalendarEventPreviewItem)}>
                  {(calendarItem) => (
                    <CalendarEventPreviewDetails event={calendarItem().event} />
                  )}
                </Show>

                {/* Visual preview for images */}
                <Show when={props.documentInfo.type === 'image'}>
                  <Card.Body class="px-3 pt-2 pb-3">
                    <Card
                      variant="filled"
                      offset={1}
                      class="overflow-hidden rounded-lg"
                    >
                      <ImageCoverStrip
                        documentId={accessibleItem().id}
                        fileType={accessibleItem().fileType}
                        class="shrink-0 h-32"
                      />
                    </Card>
                  </Card.Body>
                </Show>

                {/* Message excerpt and snapshot details */}
                <Show when={messageContext() || props.snapshotInfo}>
                  <Card.Body class="pt-2">
                    <Show when={messageContext()}>
                      {(context) => (
                        <div class="mb-2 text-sm text-ink-muted border-l-2 border-edge pl-3 py-1">
                          <div class="line-clamp-3 wrap-break-word">
                            <StaticMarkdown
                              markdown={context().content}
                              theme={channelTheme}
                              target="internal"
                            />
                          </div>
                        </div>
                      )}
                    </Show>

                    <Show when={props.snapshotInfo}>
                      {(snapshot) => (
                        <div class="mt-2 pt-2 border-t border-edge">
                          <div class="flex items-center gap-1.5 text-ink-muted">
                            <ClockIcon class="size-3" />
                            <span class="text-xs font-medium font-mono uppercase">
                              Snapshot from{' '}
                              {formatDate(new Date(snapshot().date), {
                                showTime: true,
                              })}
                            </span>
                          </div>
                        </div>
                      )}
                    </Show>
                  </Card.Body>
                </Show>
              </div>
            </TaskPropertiesPreviewProvider>
          );
        }}
      </Match>

      {/* No access / does not exist errors */}
      <Match when={matches(item(), isPreviewItemNoAccess)}>
        {(noAccessItem) => (
          <Show
            when={
              noAccessItem().access === 'does_not_exist' &&
              props.useFallbackData &&
              props.documentInfo.name
            }
            fallback={
              <div class="text-sm p-4">
                {noAccessItem().access === 'no_access' ? (
                  <Unauthorized />
                ) : (
                  <NotFound />
                )}
              </div>
            }
          >
            <Card.Header class="py-2.5">
              <Item class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 border-0 p-0">
                <Item.Icon class="col-start-1 row-start-1">
                  <EntityIcon targetType={props.documentInfo.type} size="xs" />
                </Item.Icon>
                <Item.Content class="col-start-2 row-start-1">
                  <PreviewTitle name={props.documentInfo.name ?? ''} />
                </Item.Content>
                {renderActionButtons()}
              </Item>
            </Card.Header>
          </Show>
        )}
      </Match>
    </Switch>
  );
}

/**
 * Floating hover-card preview for document references. This is the shell used by
 * {@link import('./ItemPreview').ItemPreview} hover cards: a fixed-width,
 * floating, rounded filled card with a semantic border and drop
 * shadow, plus mouse-enter/leave handling to keep the card alive while hovered.
 *
 * The reusable body lives in {@link DocumentPreviewContent}; this component only
 * adds the floating/highlight chrome around it.
 */
export function PopupPreview(
  props: DocumentPreviewContentProps & {
    mouseEnter: () => void;
    mouseLeave: () => void;
  }
) {
  return (
    <div
      class="select-none w-80 text-ink"
      onMouseEnter={props.mouseEnter}
      onMouseLeave={props.mouseLeave}
    >
      <Card
        variant="filled"
        depth={2}
        class="rounded-xl shadow-lg shadow-drop-shadow"
      >
        <DocumentPreviewContent
          delete={props.delete}
          collapseInfo={props.collapseInfo}
          documentInfo={props.documentInfo}
          previewInfo={props.previewInfo}
          snapshotInfo={props.snapshotInfo}
          useFallbackData={props.useFallbackData}
        />
      </Card>
    </div>
  );
}
