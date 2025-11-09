import { CircleSpinner } from '@core/component/CircleSpinner';
import { HoverButtonWrapper } from '@core/component/FileList/HoverButtonWrapper';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { formatDate } from '@core/util/date';
import { isErr } from '@core/util/maybeResult';
import ArrowsOutSimple from '@icon/regular/arrows-out-simple.svg?component-solid';
import ThreeDotsIcon from '@icon/regular/dots-three.svg?component-solid';
import FileIcon from '@icon/regular/file.svg?component-solid';
import FileDocIcon from '@icon/regular/file-doc.svg?component-solid';
import FileImageIcon from '@icon/regular/file-image.svg?component-solid';
import FilePdfIcon from '@icon/regular/file-pdf.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { Attachment } from '@service-comms/generated/models/attachment';
import { type Component, createSignal, onMount, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { commsServiceClient } from '../../service-comms/client';
import {
  channelIdSignal,
  isLoadingFilesSignal,
  sharedFilesSignal,
} from '../signal/sharedFilesSignal';

export function SharedFilesSection(props: { contactEmail: string }) {
  const sharedFiles = sharedFilesSignal.get;
  const setSharedFiles = sharedFilesSignal.set;
  const isLoadingFiles = isLoadingFilesSignal.get;
  const setIsLoadingFiles = isLoadingFilesSignal.set;
  const setChannelId = channelIdSignal.set;

  onMount(async () => {
    console.log(
      '[SharedFiles] Component mounted for contact:',
      props.contactEmail
    );
    await loadSharedFiles();
  });

  async function loadSharedFiles() {
    setIsLoadingFiles(true);
    console.log(
      '[SharedFiles] Starting to load shared files for:',
      props.contactEmail
    );

    try {
      // Get or create the DM channel with this contact
      console.log(
        '[SharedFiles] Calling getOrCreateDirectMessage with recipient_id:',
        props.contactEmail
      );
      const dmResult = await commsServiceClient.getOrCreateDirectMessage({
        recipient_id: props.contactEmail,
      });

      console.log('[SharedFiles] DM Result:', dmResult);

      if (isErr(dmResult)) {
        console.error('[SharedFiles] Failed to get DM channel:', dmResult);
        setIsLoadingFiles(false);
        return;
      }

      const [, dmData] = dmResult;
      console.log('[SharedFiles] DM Data:', dmData);
      console.log('[SharedFiles] Channel ID:', dmData.channel_id);

      setChannelId(dmData.channel_id);

      // Get the channel data including attachments
      console.log(
        '[SharedFiles] Calling getChannel with channel_id:',
        dmData.channel_id
      );
      const channelResult = await commsServiceClient.getChannel({
        channel_id: dmData.channel_id,
      });

      console.log('[SharedFiles] Channel Result:', channelResult);

      if (!isErr(channelResult)) {
        const [, channelData] = channelResult;
        console.log('[SharedFiles] Channel Data:', channelData);
        console.log(
          '[SharedFiles] Attachments array:',
          channelData.attachments
        );
        console.log(
          '[SharedFiles] Number of attachments:',
          channelData.attachments?.length || 0
        );

        // Log each attachment for debugging
        if (channelData.attachments && channelData.attachments.length > 0) {
          channelData.attachments.forEach((att, index) => {
            console.log(`[SharedFiles] Attachment ${index}:`, att);
          });
        }

        // Sort attachments by date, most recent first
        const sortedAttachments = [...channelData.attachments].sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          return bTime - aTime;
        });

        console.log('[SharedFiles] Sorted attachments:', sortedAttachments);
        setSharedFiles(sortedAttachments);
      } else {
        console.error(
          '[SharedFiles] Failed to get channel data:',
          channelResult
        );
      }
    } catch (error) {
      console.error('[SharedFiles] Error loading shared files:', error);
    } finally {
      setIsLoadingFiles(false);
      console.log(
        '[SharedFiles] Finished loading. Final shared files count:',
        sharedFiles().length
      );
    }
  }

  const EmptyState = () => (
    <div class="flex flex-col items-center justify-center py-8 text-ink-muted">
      <FileIcon class="w-8 h-8 mb-2" />
      <span class="text-sm">No files shared</span>
    </div>
  );

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center justify-between px-4 py-2 border-b border-edge">
        <h3 class="text-sm font-medium">Files Shared in Channel</h3>
        <Show when={sharedFiles().length > 0}>
          <span class="text-xs text-ink-muted">
            {sharedFiles().length} files
          </span>
        </Show>
      </div>

      <div class="flex-1 overflow-hidden">
        <Show
          when={!isLoadingFiles()}
          fallback={
            <div class="flex items-center justify-center h-full">
              <CircleSpinner />
            </div>
          }
        >
          <Show when={sharedFiles().length > 0} fallback={<EmptyState />}>
            <VList data={sharedFiles()} class="flex-1 px-4 py-2" overscan={5}>
              {(attachment) => <FileItem attachment={attachment} />}
            </VList>
          </Show>
        </Show>
      </div>
    </div>
  );
}

const getFileIcon = (entityType: string) => {
  switch (entityType.toLowerCase()) {
    case 'document':
    case 'doc':
    case 'docx':
      return FileDocIcon;
    case 'pdf':
      return FilePdfIcon;
    case 'image':
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
      return FileImageIcon;
    default:
      return FileIcon;
  }
};

const FileItem: Component<{ attachment: Attachment }> = (props) => {
  const [hovering, setHovering] = createSignal(false);
  const FileIconComponent = getFileIcon(props.attachment.entity_type);

  const { replaceOrInsertSplit } = useSplitLayout();

  return (
    <ContextMenu>
      <ContextMenu.Trigger>
        <div
          class="h-14 rounded p-2 text-xs hover:bg-hover hover-transition-bg mb-2 cursor-pointer flex items-center gap-3"
          onClick={() => {
            replaceOrInsertSplit({
              type: props.attachment.entity_type as any,
              id: props.attachment.entity_id,
            });
          }}
          onpointerenter={() => setHovering(true)}
          onpointerleave={() => setHovering(false)}
        >
          <div class="flex-shrink-0">
            <FileIconComponent class="w-5 h-5 text-ink-muted" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="truncate font-medium">{props.attachment.entity_id}</div>
            <div class="text-ink-muted text-xs">
              {formatDate(
                new Date(props.attachment.created_at).getTime() / 1000
              )}
            </div>
          </div>
          <Show when={!isTouchDevice}>
            <div class="flex-shrink-0">
              <HoverButtonWrapper
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.dispatchEvent(
                    new MouseEvent('contextmenu', {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                      button: 2,
                      buttons: 2,
                      clientX:
                        e.currentTarget.getBoundingClientRect().left +
                        e.currentTarget.offsetWidth / 2,
                      clientY:
                        e.currentTarget.getBoundingClientRect().top +
                        e.currentTarget.offsetHeight / 2,
                    })
                  );
                }}
                size="sm"
                showOnHover={hovering()}
              >
                <ThreeDotsIcon class="size-full" />
              </HoverButtonWrapper>
            </div>
          </Show>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class={`z-item-options-menu ${isMobileWidth() && isTouchDevice ? 'w-[calc(100vw-1rem)]' : ''}`}
        >
          <ContextMenu.Item class="w-full">
            <MenuItem text="Open in New Tab" icon={ArrowsOutSimple} />
          </ContextMenu.Item>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};
