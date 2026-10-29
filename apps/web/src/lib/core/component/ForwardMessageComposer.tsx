import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import { createConfiguredChannelMarkdownEditor } from '@channel/Input/configured-markdown-editor';
import { Input } from '@channel/Input/Input';
import { createMentionsTracker } from '@channel/Input/mentions-tracker';
import { buildPostMessageRequest } from '@channel/Input/message-payload';
import { uploadInputAttachments } from '@channel/Input/upload-attachments';
import type { UploadResult } from '@channel/Input/utils/file-helpers';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import type { MessageEditorOptions } from '@core/messages/configured-message-editor';
import { fireAndForget } from '@core/util/fireAndForget';
import { handleFileFolderDrop } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { CustomScrollbar } from './CustomScrollbar';
import { MarkdownShell } from './LexicalMarkdown/builder/MarkdownShell';
import { ScrollIndicators } from './VerticalScrollIndicators';

false && fileFolderDrop;

export function createForwardMessageComposer(options: {
  resolveAppLink?: MessageEditorOptions['resolveAppLink'];
  uploadFile: (file: File) => Promise<UploadResult>;
  isSending: Accessor<boolean>;
}) {
  const tracker = createInputAttachmentTracker();
  const mentions = createMentionsTracker();
  const [markdown, setMarkdown] = createSignal('');
  const [uploads, setUploads] = createSignal(0);
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);
  let active = true;

  const clear = () => {
    for (const attachment of tracker.attachments()) {
      if (attachment.previewSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewSrc);
      }
    }
    tracker.clearAttachments();
  };
  onCleanup(() => {
    active = false;
    clear();
  });

  const attachFiles = async (files: File[]) => {
    if (!active || options.isSending()) return;
    setUploads((count) => count + 1);
    try {
      await Telemetry.span('share.attach_files', async (span) => {
        span.setAttr('attachment.count', files.length);
        await uploadInputAttachments({
          files,
          tracker,
          uploadFile: (file) =>
            span.span('share.upload_attachment', async (uploadSpan) => {
              uploadSpan.setAttr('file.size', file.size);
              const result = await options.uploadFile(file);
              if (result.failed) uploadSpan.error('Attachment upload failed');
              else if ('id' in result)
                uploadSpan.setAttr('attachment.id', result.id);
              return result;
            }),
          isActive: () => active,
        });
      });
    } finally {
      setUploads((count) => count - 1);
    }
  };

  const attachEntries = async (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => {
    if (!active || options.isSending()) return;
    setUploads((count) => count + 1);
    try {
      await handleFileFolderDrop(files, directories, (entries) =>
        attachFiles(entries.map((entry) => entry.file))
      );
    } finally {
      setUploads((count) => count - 1);
    }
  };

  // Bare Enter keeps the optional message multiline; the Share surface owns
  // Cmd/Ctrl+Enter and guards it while attachments are uploading.
  const editor = createConfiguredChannelMarkdownEditor({
    namespace: 'forward-to-channel-markdown',
    resolveAppLink: options.resolveAppLink,
    enableMentions: true,
    scrollContainer: scrollRef,
    onChange: setMarkdown,
    onMentionCreate: mentions.onMentionCreate,
    onMentionRemove: mentions.onMentionRemove,
    onPasteFilesAndDirs: (files, directories) => {
      fireAndForget(attachEntries(files, directories), 'share-attachments');
    },
    onAttachFromDisk: (files) =>
      fireAndForget(attachFiles(files), 'share-attachments'),
  });

  return {
    editor,
    tracker,
    scrollRef,
    setScrollRef,
    isDraggedOver,
    setIsDraggedOver,
    attachFiles,
    attachEntries,
    clear,
    isSending: options.isSending,
    isUploading: () => uploads() > 0 || tracker.hasPending(),
    message: () =>
      buildPostMessageRequest({
        snapshot: {
          value: markdown(),
          attachments: tracker.attachments(),
          mentions: mentions.mentions(),
        },
      }),
  };
}

export function ForwardMessageComposer(props: {
  composer: ReturnType<typeof createForwardMessageComposer>;
}) {
  return (
    <Input.Root
      class="w-full max-w-none min-h-0 items-stretch"
      input={{
        mode: 'channel',
        attachments: props.composer.tracker.attachments(),
        hasPendingAttachments: props.composer.isUploading(),
        isDraggedOver: props.composer.isDraggedOver(),
      }}
      commands={{
        attachFiles: props.composer.attachFiles,
        removeAttachment: (attachment) => {
          if (props.composer.isSending()) return;
          props.composer.tracker.removeAttachment(attachment.id);
          if (attachment.previewSrc?.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.previewSrc);
          }
        },
      }}
    >
      <div
        class="contents"
        use:fileFolderDrop={{
          onDragStart: props.composer.setIsDraggedOver,
          onDragEnd: () => props.composer.setIsDraggedOver(false),
          onDrop: (files, directories) =>
            fireAndForget(
              props.composer.attachEntries(files, directories),
              'share-attachments'
            ),
        }}
      >
        <Input.DropOverlay />
        <div class="relative grow shrink min-h-0 flex flex-col">
          <ScrollIndicators
            scrollRef={props.composer.scrollRef}
            noBorderStart
          />
          <CustomScrollbar scrollContainer={props.composer.scrollRef} />
          <div
            class="grow shrink min-h-20 max-h-56 overflow-y-auto scrollbar-hidden px-4 mobile:px-3 py-1.5 w-full text-sm"
            ref={props.composer.setScrollRef}
          >
            <div onClick={() => props.composer.editor.controls.focus()}>
              <MarkdownShell
                config={props.composer.editor}
                placeholder="Optional message"
                portalScope="local"
                class="text-sm min-h-20"
              />
            </div>
            <Input.Attachments kind="media" />
            <Input.Attachments kind="document" />
          </div>
        </div>
        <div class="px-3 py-1 flex items-center">
          <Input.AttachFilesAction disabled={props.composer.isSending()} />
        </div>
      </div>
    </Input.Root>
  );
}
