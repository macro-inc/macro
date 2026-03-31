// URL params constants
import { URL_PARAMS as URL_PARAMS_CANVAS } from '@block-canvas/constants';
import { URL_PARAMS as URL_PARAMS_CHANNEL } from '@block-channel/constants';
import { useOpenChatForAttachment } from '@block-chat/client';
import { URL_PARAMS as URL_PARAMS_MD } from '@block-md/constants';
import { URL_PARAMS as URL_PARAMS_PDF } from '@block-pdf/signal/location';
import {
  type BlockAlias,
  type BlockName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
// Components
import { ClippedPanel } from '@core/component/ClippedPanel';
import { toast } from '@core/component/Toast/Toast';
import {
  isAccessiblePreviewItem,
  isChannelPreviewItem,
  isPreviewItemNoAccess,
} from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { tryMacroId, useDisplayName } from '@core/user';
import { matches } from '@core/util/match';
// Icon imports
import CollapseInlinePreview from '@icon/regular/arrows-in-line-horizontal.svg';
import OpenIcon from '@icon/regular/arrows-out.svg';
import ExpandInlinePreview from '@icon/regular/arrows-out-line-horizontal.svg';
import MessageIcon from '@icon/regular/chat-circle.svg';
import ThreadIcon from '@icon/regular/chats-circle.svg';
import Clipboard from '@icon/regular/clipboard.svg';
import GitBranchIcon from '@icon/regular/git-branch.svg';
import ClockIcon from '@icon/regular/clock.svg';
import ColumnsPlusRight from '@icon/regular/columns-plus-right.svg';
import HighlightIcon from '@icon/regular/highlighter-circle.svg';
import MapPinIcon from '@icon/regular/map-pin-simple.svg';
import SparkleIcon from '@icon/regular/sparkle.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import TrashSimple from '@icon/regular/trash-simple.svg';
import MacroEmbed from '@macro-icons/macro-embed.svg';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon as UserIconComponent } from '@core/component/UserIcon';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { Component, JSX } from 'solid-js';
import { createMemo, For, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useEntityProperties } from '@core/component/Properties/hooks';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { PropertyValue } from '@core/component/Properties/component/propertyValue/PropertyValue';
import { beveledCorners } from '../signal/beveledCorners';
import { formatDate } from '../util/date';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { Tooltip } from './Tooltip';
import { useItemPreviewData } from './ItemPreview';

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
      class={`${props.align === 'right' ? 'justify-right' : 'justify-left'} mt-2 ${props.align === 'left' ? 'w-fit max-w-[66%]' : ''} text-ink-muted ${props.align === 'left' ? 'overflow-hidden whitespace-nowrap text-ellipsis' : ''}`}
    >
      <span class="relative text-[0.8em] text-ink-muted max-w-full flex items-center">
        <Dynamic component={props.icon} class="relative size-3 mx-1" />
        {props.children}
      </span>
    </div>
  );
}

/**
 * User info with icon and display name
 */
function UserInfo(props: { userId: string }) {
  const [displayName] = useDisplayName(tryMacroId(props.userId));
  return (
    <div class="justify-left mt-2 w-fit max-w-[66%] text-ink-muted overflow-hidden whitespace-nowrap text-ellipsis flex items-center gap-1.5">
      <UserIconComponent
        id={props.userId}
        size="xs"
        suppressClick
        showTooltip={false}
      />
      <span class="relative text-[0.8em] text-ink-muted max-w-full">
        {displayName()}
      </span>
    </div>
  );
}

/**
 * Popup preview component for document references
 */
function ImageCoverStrip(props: { documentId: string; class?: string }) {
  const query = useBinaryDocumentQuery(() => props.documentId);

  // Captured once at mount: true means the spinner was shown and we should fade in.
  // Reading .isLoading (not .data) avoids triggering Suspense here.
  const shouldFadeIn = query.isLoading;

  return (
    <div
      class={`w-full overflow-hidden relative bg-edge-muted ${props.class ?? 'h-32'}`}
    >
      <Suspense
        fallback={
          <div class="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner class="size-5 animate-spin text-ink-muted" />
          </div>
        }
      >
        <Show when={query.data}>
          {(url) => (
            <img
              src={url()}
              class={`absolute inset-0 w-full h-full object-cover ${shouldFadeIn ? 'opacity-0 transition-opacity duration-300' : ''}`}
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

const TASK_PREVIEW_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

function TaskPropertiesPreview(props: { taskId: string }) {
  const { properties, isLoading } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );

  const previewProperties = createMemo(() =>
    TASK_PREVIEW_PROPERTIES.flatMap((id) => {
      const p = properties().find((p) => p.propertyDefinitionId === id);
      return p ? [p] : [];
    })
  );

  return (
    <Show when={!isLoading() && previewProperties().length > 0}>
      <div class="px-2 pb-2 flex flex-row flex-wrap gap-1 text-xs justify-start">
        <For each={previewProperties()}>
          {(property) => (
            <Show when={property.value !== null}>
              <div class="w-fit max-w-full">
                <PropertyValue property={property} />
              </div>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

export function PopupPreview(props: {
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
}) {
  // Hooks
  const navigate = useNavigate();

  const blockName = useMaybeBlockName();
  const blockId = useMaybeBlockId();

  const itemPreviewEntity = () => {
    const type = blockNameToItemType(props.documentInfo.type);
    let messageId: string | undefined;
    if (
      type === 'channel' &&
      URL_PARAMS_CHANNEL.message in props.documentInfo.params
    ) {
      messageId = props.documentInfo.params[URL_PARAMS_CHANNEL.message];
    }
    return { id: props.documentInfo.id, type, messageId };
  };

  const { item, ItemEntityIcon } = useItemPreviewData(itemPreviewEntity);

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

  const handleCopyBranchName = () => {
    const previewItem = item();
    const docName =
      props.documentInfo.name ||
      ('name' in previewItem ? (previewItem.name as string) : '') ||
      '';
    copyBranchNameToClipboard(props.documentInfo.id, docName);
  };

  const openInNewSplit = createCallback(() => {
    const splitManager = globalSplitManager();
    if (splitManager) {
      splitManager.createNewSplit({
        content: {
          type: props.documentInfo.type,
          id: props.documentInfo.id,
          params: props.documentInfo.params,
        },
        referredFrom: null,
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
            icon={MacroEmbed}
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

    if (props.documentInfo.type === 'task') {
      buttons.push(
        <PopupIconButton
          tooltip="Copy Branch Name"
          onClick={handleCopyBranchName}
          icon={GitBranchIcon}
        />
      );
    }

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

  return (
    <div
      class="select-none overflow-hidden w-80 text-ink"
      onMouseEnter={props.mouseEnter}
      onMouseLeave={props.mouseLeave}
    >
      <ClippedPanel tl={!beveledCorners()} active>
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
                return isChannelPreviewItem(item)
                  ? item.messageContext
                  : undefined;
              };

              return (
                <div class="w-full flex flex-col">
                  {/* Header: icon + filename + action buttons */}
                  <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <ItemEntityIcon size="sm" />
                      <div class="text-sm font-semibold select-text min-w-0">
                        <Show when={accessories()}>
                          {(acc) => (
                            <div class="text-[0.8em] text-ink-muted mt-1 select-none">
                              {`${acc().note} `}
                              {getMentionsIcon(acc().icon)}
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                    <div class="flex shrink-0">{renderActionButtons()}</div>
                  </div>

                  <div class="line-clamp-2 break-words px-2 mb-2">
                    {props.documentInfo.name || accessibleItem().name}
                  </div>

                  {/* Task properties: status, priority, assignees */}
                  <Show when={props.documentInfo.type === 'task'}>
                    <TaskPropertiesPreview taskId={props.documentInfo.id} />
                  </Show>

                  {/* Visual preview for images */}
                  <Show when={props.documentInfo.type === 'image'}>
                    <ImageCoverStrip
                      documentId={accessibleItem().id}
                      class="shrink-0 h-32"
                    />
                  </Show>

                  {/* Footer: message context + owner/timestamp */}
                  <Show
                    when={
                      messageContext() ||
                      accessibleItem().owner ||
                      accessibleItem().updatedAt ||
                      props.snapshotInfo
                    }
                  >
                    <div class="px-2 py-2 border-t border-edge-muted">
                      <Show when={messageContext()}>
                        {(context) => (
                          <div class="mb-2 text-sm text-ink-muted border-l-2 border-edge pl-3 py-1">
                            <div class="line-clamp-3 break-words">
                              <StaticMarkdown
                                markdown={context().content}
                                theme={channelTheme}
                                target="internal"
                              />
                            </div>
                          </div>
                        )}
                      </Show>

                      <div class="flex justify-between items-center text-sm font-medium">
                        <Show
                          when={messageContext()}
                          fallback={
                            <Show when={accessibleItem().owner}>
                              {(owner) => <UserInfo userId={owner()} />}
                            </Show>
                          }
                        >
                          {(context) => (
                            <UserInfo userId={context().sender_id} />
                          )}
                        </Show>

                        <Show
                          when={messageContext()}
                          fallback={
                            <Show when={accessibleItem().updatedAt}>
                              {(time) => (
                                <MetadataInfo icon={ClockIcon} align="right">
                                  <span class="text-xxs font-mono uppercase">
                                    {formatDate(time())}
                                  </span>
                                </MetadataInfo>
                              )}
                            </Show>
                          }
                        >
                          {(context) => (
                            <MetadataInfo icon={ClockIcon} align="right">
                              {formatDate(context().created_at)}
                            </MetadataInfo>
                          )}
                        </Show>
                      </div>

                      <Show when={props.snapshotInfo}>
                        {(snapshot) => (
                          <div class="mt-2 pt-2 border-t border-edge">
                            <div class="flex items-center gap-1.5 text-ink-muted">
                              <ClockIcon class="size-3" />
                              <span class="text-xxs font-medium font-mono uppercase">
                                Snapshot from{' '}
                                {formatDate(new Date(snapshot().date), {
                                  showTime: true,
                                })}
                              </span>
                            </div>
                          </div>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </Match>

          {/* No access / does not exist errors */}
          <Match when={matches(item(), isPreviewItemNoAccess)}>
            {(noAccessItem) => (
              <div class="text-sm p-4">
                {noAccessItem().access === 'no_access' ? (
                  <Unauthorized />
                ) : (
                  <NotFound />
                )}
              </div>
            )}
          </Match>
        </Switch>
      </ClippedPanel>
    </div>
  );
}
