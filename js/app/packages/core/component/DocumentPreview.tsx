// URL params constants
import { URL_PARAMS as URL_PARAMS_CANVAS } from '@block-canvas/constants';
import { URL_PARAMS as URL_PARAMS_CHANNEL } from '@block-channel/constants';
import { useOpenChatForAttachment } from '@block-chat/client';
import { URL_PARAMS as URL_PARAMS_MD } from '@block-md/constants';
import { URL_PARAMS as URL_PARAMS_PDF } from '@block-pdf/signal/location';
import {
  type BlockName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import {
  isAccessiblePreviewItem,
  type PreviewChannelAccess,
  type PreviewDocumentAccess,
  type PreviewItem,
  type PreviewItemAccess,
  type PreviewItemNoAccess,
  type PreviewProjectAccess,
} from '@core/signal/preview';
import { matches } from '@core/util/match';

// Icon imports
import CollapseInlinePreview from '@icon/regular/arrows-in-line-horizontal.svg';
import OpenIcon from '@icon/regular/arrows-out.svg';
import ExpandInlinePreview from '@icon/regular/arrows-out-line-horizontal.svg';
import MessageIcon from '@icon/regular/chat-circle.svg';
import ThreadIcon from '@icon/regular/chats-circle.svg';
import Clipboard from '@icon/regular/clipboard.svg';
import ClockIcon from '@icon/regular/clock.svg';
import ColumnsPlusRight from '@icon/regular/columns-plus-right.svg';
import HighlightIcon from '@icon/regular/highlighter-circle.svg';
import MapPinIcon from '@icon/regular/map-pin-simple.svg';
import SparkleIcon from '@icon/regular/sparkle.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import TrashSimple from '@icon/regular/trash-simple.svg';
import UserIcon from '@icon/regular/user.svg';

// Components
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { Component, ComponentProps, JSX } from 'solid-js';
import { type Accessor, Match, Show, Switch } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { formatDate } from '../util/date';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { EntityIcon } from './EntityIcon';
import { floatWithElement } from './LexicalMarkdown/directive/floatWithElement';
import { Tooltip } from './Tooltip';

false && floatWithElement;

const CustomEmbedIcon: Component<ComponentProps<'svg'>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" {...props}>
    {/* Background (invisible) */}
    <rect width="256" height="256" fill="none" />
    {/* Top line */}
    <line
      x1="40"
      y1="60"
      x2="216"
      y2="60"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="16"
    />
    {/* Box */}
    <rect
      x="72"
      y="96"
      width="112"
      height="48"
      rx="8"
      fill="none"
      stroke="currentColor"
      stroke-width="16"
    />
    {/* Bottom line */}
    <line
      x1="40"
      y1="176"
      x2="216"
      y2="176"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="16"
    />
  </svg>
);

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
  blockName: BlockName,
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
    const threadId = params[URL_PARAMS_CHANNEL.thread];
    const messageId = params[URL_PARAMS_CHANNEL.message];
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
  else if (blockName === 'md') {
    const id = params[URL_PARAMS_MD.nodeId];
    const loc = params[URL_PARAMS_MD.location];
    if (id?.trim() || loc?.trim()) {
      return { icon: 'highlight', note: 'Snippet' };
    }
  }
};

function PopupIcon(props: {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}) {
  return (
    <Dynamic
      component={props.icon}
      class="relative size-4 inline-flex items-center mx-1"
    />
  );
}

function PopupIconButton(props: {
  tooltip: string;
  onClick: () => void;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}) {
  return (
    <Tooltip tooltip={props.tooltip}>
      <button
        onClick={props.onClick}
        class="rounded-md py-1 hover:bg-hover transition flex items-center gap-1.5"
      >
        <div class="w-fit flex justify-right items-center mx-0.5 my-0.5 text-xs font-normal text-current/90">
          <PopupIcon icon={props.icon} />
        </div>
      </button>
    </Tooltip>
  );
}

function _PopupTextButton(props: {
  tooltip: string;
  onClick: () => void;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  text: string;
}) {
  return (
    <div class="w-fit h-full">
      <Tooltip tooltip={props.tooltip}>
        <button
          onClick={props.onClick}
          class="rounded-md py-1 hover:bg-hover transition flex items-center gap-1.5"
        >
          <div class="w-fit flex justify-right items-center pl-0.5 mx-1.5 my-0.5 text-xs font-normal text-current/90">
            {props.text}
            {props.icon && <PopupIcon icon={props.icon} />}
          </div>
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Popup preview component for document references
 */
export function PopupPreview(props: {
  item: Accessor<PreviewItem>;
  floatRef: HTMLElement;
  mouseEnter: () => void;
  mouseLeave: () => void;
  delete?: () => void;
  collapseInfo?: {
    isCollapsable: boolean;
    isCollapsed: boolean;
    handleCollapse: () => void;
  };
  documentInfo: {
    id: string;
    type: BlockName;
    params: Record<string, string>;
    isOpenable?: boolean;
  };
  previewInfo?: {
    showPreview: boolean;
    isPreviewable: boolean;
    handlePreviewToggle: () => void;
  };
}) {
  // Hooks
  const navigate = useNavigate();

  const blockName = useMaybeBlockName();
  const blockId = useMaybeBlockId();

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

  const openDocument = createCallback(() => {
    let link = `/${props.documentInfo.type}/${props.documentInfo.id}`;
    if (props.documentInfo.params) {
      const queryParams = new URLSearchParams(
        props.documentInfo.params
      ).toString();
      link += `?${queryParams}`;
    }
    navigate(`${link}`);
  });

  // Handle opening document in chat
  const openChatForAttachment = useOpenChatForAttachment();
  const handleOpenInChat = () => {
    openChatForAttachment({
      attachmentId: props.documentInfo.id,
      callerBlock:
        blockName && blockId ? { name: blockName, id: blockId } : undefined,
    });
  };

  const handleCopy = () => {
    try {
      let hostname = window.location.hostname.replace('www.', '').toLowerCase();
      if (hostname === 'localhost') {
        hostname = 'dev.macro.com';
      }
      let link = `https://${hostname}/app/${props.documentInfo.type}/${props.documentInfo.id}`;

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

  const openInNewSplit = createCallback(() => {
    const splitManager = globalSplitManager();
    if (splitManager) {
      splitManager.createNewSplit({
        type: props.documentInfo.type,
        id: props.documentInfo.id,
        params: props.documentInfo.params,
      });
    }
  });

  /**
   * Renders the action buttons for the preview
   */
  const renderActionButtons = () => {
    const buttons = [];

    // Preview toggle button
    if (props.previewInfo?.showPreview) {
      buttons.push(
        <Show when={props.previewInfo.showPreview}>
          <PopupIconButton
            tooltip={
              props.previewInfo.isPreviewable
                ? 'Convert to Embed'
                : 'Convert to Card View'
            }
            onClick={props.previewInfo.handlePreviewToggle}
            icon={CustomEmbedIcon}
          />
        </Show>
      );
    }

    // Collapse/expand button
    if (props.collapseInfo?.isCollapsable) {
      buttons.push(
        <>
          <Show
            when={props.collapseInfo?.isCollapsed}
            fallback={
              <PopupIconButton
                tooltip="Collapse Reference"
                onClick={handleToggleCollapse}
                icon={CollapseInlinePreview}
              />
            }
          >
            <PopupIconButton
              tooltip="Expand Reference"
              onClick={handleToggleCollapse}
              icon={ExpandInlinePreview}
            />
          </Show>
          <div class="w-px mx-1 h-6 bg-edge" />
        </>
      );
    }

    // Open in AI chat button
    if (canOpenInChat()) {
      buttons.push(
        <PopupIconButton
          tooltip="Open Document in AI Chat"
          onClick={handleOpenInChat}
          icon={SparkleIcon}
        />
      );
    }

    buttons.push(
      <PopupIconButton
        tooltip="Copy Link"
        onClick={handleCopy}
        icon={Clipboard}
      />
    );

    if (props.documentInfo.isOpenable) {
      buttons.push(
        <PopupIconButton
          tooltip="Open Fullscreen"
          onClick={openDocument}
          icon={OpenIcon}
        />
      );

      buttons.push(
        <PopupIconButton
          tooltip="Open in New Split"
          onClick={openInNewSplit}
          icon={ColumnsPlusRight}
        />
      );
    }

    if (props.delete) {
      buttons.push(
        <PopupIconButton
          tooltip="Delete"
          onClick={props.delete}
          icon={TrashSimple}
        />
      );
    }

    // Add dividers between buttons
    return buttons.map((button, _index, _array) => (
      <>
        {button}
        {/* Divider */}
        {/* {index < array.length - 1 && <div class="w-px mx-1 h-6 bg-edge" />} */}
      </>
    ));
  };

  /**
   * Renders the metadata info for the document
   */
  const renderDocumentMetadata = (
    accessibleItem: NonNullable<
      | PreviewItemAccess
      | PreviewDocumentAccess
      | PreviewProjectAccess
      | PreviewChannelAccess
    >
  ) => {
    const accessories = mentionsAccessories(
      props.documentInfo.type,
      props.documentInfo.params
    );
    return (
      <>
        <div class="text-sm font-semibold">
          {accessibleItem.name}
          {accessories && (
            <div class="relative text-[0.8em] text-current/60 rounded-md mt-1.5">
              {`${accessories.note} `}
              {getMentionsIcon(accessories.icon)}
            </div>
          )}
        </div>
        <div class="flex justify-between items-center w-full text-sm font-medium">
          <Show when={props.item().owner}>
            {(name) => (
              <div class="justify-left mt-2 w-fit max-w-[66%] text-ink-muted overflow-hidden whitespace-nowrap text-ellipsis">
                <span class="relative text-[0.8em] text-ink-muted max-w-full">
                  <UserIcon class="relative top-[-0.125em] size-4 inline-flex items-center mr-1" />
                  {name().replace('macro|', '')}
                </span>
              </div>
            )}
          </Show>
          <Show when={props.item().updatedAt}>
            {(time) => (
              <div class="justify-right mt-2">
                <span class="relative text-[0.8em] text-ink-muted">
                  <ClockIcon class="relative top-[-0.125em] size-4 inline-flex items-center mr-1" />
                  {formatDate(time())}
                </span>
              </div>
            )}
          </Show>
        </div>
      </>
    );
  };

  return (
    <Portal>
      <div
        class="absolute select-none overflow-hidden z-toast-region w-80 bg-dialog ring-1 ring-edge text-ink rounded-lg"
        use:floatWithElement={{ element: () => props.floatRef }}
        onMouseEnter={props.mouseEnter}
        onMouseLeave={props.mouseLeave}
      >
        <div class="p-3">
          <Switch>
            {/* Loading state */}
            <Match when={props.item().loading}>
              <Loading />
            </Match>

            {/* Accessible preview */}
            <Match when={matches(props.item(), isAccessiblePreviewItem)}>
              {(accessibleItem) => {
                const { type, fileType } = accessibleItem();
                return (
                  <div class="w-full h-full flex-col">
                    {/* Header with icon and actions */}
                    <div class="flex w-full mb-2">
                      <div class="w-full size-10">
                        <Show
                          when={type === 'channel'}
                          fallback={
                            <EntityIcon
                              targetType={type === 'document' ? fileType : type}
                              size="md"
                            />
                          }
                        >
                          <EntityIcon
                            size="md"
                            targetType={
                              accessibleItem().channelType === 'direct_message'
                                ? 'directMessage'
                                : accessibleItem().channelType ===
                                    'organization'
                                  ? 'company'
                                  : 'channel'
                            }
                          />
                        </Show>
                      </div>
                      <div class="flex w-fit h-full justify-right">
                        {renderActionButtons()}
                      </div>
                    </div>

                    {/* Document metadata */}
                    {renderDocumentMetadata(accessibleItem())}
                  </div>
                );
              }}
            </Match>

            {/* No access error */}
            <Match
              when={
                (props.item() as PreviewItemNoAccess).access === 'no_access'
              }
            >
              <div class="text-sm p-4">
                <Unauthorized />
              </div>
            </Match>

            {/* Does not exist error */}
            <Match
              when={
                (props.item() as PreviewItemNoAccess).access ===
                'does_not_exist'
              }
            >
              <div class="text-sm p-4">
                <NotFound />
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Portal>
  );
}
