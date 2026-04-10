import { staticFileIdEndpoint } from '@core/constant/servers';
import { EntityIcon } from '@core/component/EntityIcon';
import SpinnerIcon from '@icon/bold/spinner-gap-bold.svg';
import XIcon from '@icon/regular/x.svg';
import { MediaImage } from '@channel/Media/MediaImage';
import { MediaVideo } from '@channel/Media/MediaVideo';
import { cn } from '@ui/utils/classname';
import {
  children,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  splitProps,
  Switch,
  type JSX,
} from 'solid-js';
import { MediaViewerDialog } from '@channel/Media/MediaViewerDialog';
import type { MediaItem } from '@channel/Media/media-items';
import { useInput, useInputCommands } from './context';
import type { InputAttachmentData, InputAttachmentKind } from './types';

type AttachmentsProps = JSX.HTMLAttributes<HTMLDivElement> & {
  kind?: InputAttachmentKind | 'media';
};

function truncateFilename(name: string, maxLength = 24): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}…`;
}

function RemoveButton(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={cn(
        'hover:bg-hover hover-transition-bg rounded-md p-1 [@media(hover:none)]:p-2 items-center flex',
        props.class
      )}
      onClick={(event) => {
        event.stopPropagation();
        props.onRemove(props.attachment);
      }}
      aria-label={`Remove ${props.attachment.name}`}
    >
      <XIcon class="text-ink-muted group-hover:text-failure size-3 [@media(hover:none)]:size-4" />
    </button>
  );
}

function MediaAttachmentItem(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
  onOpen?: () => void;
}) {
  const mediaSrc = () => staticFileIdEndpoint(props.attachment.id);

  return (
    <div class="ph-no-capture relative group">
      <Show
        when={!props.attachment.pending && props.attachment.kind === 'image'}
        fallback={
          <Show
            when={
              !props.attachment.pending && props.attachment.kind === 'video'
            }
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge-muted rounded-md bg-menu">
                <SpinnerIcon class="w-4 h-4 animate-spin" />
              </div>
            }
          >
            <button type="button" onClick={() => props.onOpen?.()}>
              <MediaVideo.Root class="size-23 group overflow-hidden border border-edge bg-menu">
                <MediaVideo.Preview
                  src={mediaSrc()}
                  class="size-full object-cover"
                />
                <MediaVideo.PlayOverlay />
              </MediaVideo.Root>
            </button>
            <RemoveButton
              attachment={props.attachment}
              onRemove={props.onRemove}
              class="absolute -top-2 -right-2 z-[10] rounded-full bg-menu border border-edge-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            />
          </Show>
        }
      >
        <MediaImage.Root>
          <button type="button" onClick={() => props.onOpen?.()}>
            <MediaImage.Image
              src={mediaSrc()}
              class="size-23 select-none rounded-2xl border border-edge object-cover"
              width={92}
              height={92}
              loading="lazy"
              fallback={<MediaImage.Fallback square />}
            />
          </button>
          <RemoveButton
            attachment={props.attachment}
            onRemove={props.onRemove}
            class="absolute -top-2 -right-2 z-[10] rounded-full bg-menu border border-edge-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          />
        </MediaImage.Root>
      </Show>
    </div>
  );
}

function DocumentAttachmentItem(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
}) {
  return (
    <div class="ph-no-capture group flex items-center px-2 py-1.5 space-x-1.5 hover:bg-hover hover-transition-bg cursor-default text-sm border border-edge-muted rounded-xs">
      <Show
        when={!props.attachment.pending}
        fallback={<SpinnerIcon class="w-4 h-4 animate-spin" />}
      >
        <EntityIcon
          targetType={props.attachment.iconType ?? 'unknown'}
          size="xs"
        />
      </Show>
      <span>
        {/* Note: using javascript truncation here rather than CSS because `truncate` was causing a complex bug that made it impossible to horizontally scroll documents on mobile. */}
        {truncateFilename(props.attachment.name)}
      </span>
      <RemoveButton attachment={props.attachment} onRemove={props.onRemove} />
    </div>
  );
}

export function Attachments(props: AttachmentsProps) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children', 'kind']);
  const resolved = children(() => local.children);

  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const visibleAttachments = () => {
    const items = input().attachments ?? [];
    if (!local.kind) return items;
    if (local.kind === 'media') {
      return items.filter(
        (attachment) =>
          attachment.kind === 'image' || attachment.kind === 'video'
      );
    }
    return items.filter((attachment) => attachment.kind === local.kind);
  };

  const mediaAttachments = () =>
    visibleAttachments().filter(
      (a): a is InputAttachmentData & { kind: 'image' | 'video' } =>
        !a.pending && (a.kind === 'image' || a.kind === 'video')
    );

  const mediaItems = createMemo((): MediaItem[] =>
    mediaAttachments().map((a) => ({
      id: a.id,
      src: staticFileIdEndpoint(a.id),
      kind: a.kind,
      width: a.width,
      height: a.height,
    }))
  );

  const handleRemove = (attachment: InputAttachmentData) => {
    commands.removeAttachment(attachment);
  };

  const handleOpen = (attachment: InputAttachmentData) => {
    const index = mediaAttachments().findIndex((a) => a.id === attachment.id);
    if (index === -1) return;
    setSelectedIndex(index);
    setViewerOpen(true);
  };

  return (
    <Show when={visibleAttachments().length > 0}>
      <div
        class={cn(
          'flex flex-row w-full px-2 py-2 gap-2 flex-wrap',
          // On mobile, attachments scroll horizontally
          'mobile:flex-nowrap mobile:[&>*]:shrink-0 mobile:overflow-x-auto mobile:scrollbar-hidden',
          local.class
        )}
        data-input-attachments={local.kind ?? 'all'}
        {...rest}
      >
        <Show
          when={resolved()}
          fallback={
            <For each={visibleAttachments()}>
              {(attachment) => (
                <Switch>
                  <Match
                    when={
                      attachment.kind === 'image' || attachment.kind === 'video'
                    }
                  >
                    <MediaAttachmentItem
                      attachment={attachment}
                      onRemove={handleRemove}
                      onOpen={() => handleOpen(attachment)}
                    />
                  </Match>
                  <Match when={attachment.kind === 'document'}>
                    <DocumentAttachmentItem
                      attachment={attachment}
                      onRemove={handleRemove}
                    />
                  </Match>
                </Switch>
              )}
            </For>
          }
        >
          {(children) => children()}
        </Show>
      </div>
      <MediaViewerDialog
        items={() => mediaItems()}
        open={viewerOpen()}
        onOpenChange={setViewerOpen}
        currentIndex={selectedIndex}
        onCurrentIndexChange={setSelectedIndex}
      />
    </Show>
  );
}
