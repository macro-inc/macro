import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import {
  applyInlineFormat,
  applyNodeFormat,
  createConfiguredChannelMarkdownEditor,
  createInputAttachmentTracker,
  createInputState,
  createMentionsTracker,
  FormatButtons,
  Input,
  type InputAttachmentData,
  type InputAttachmentKind,
  type InputAttachmentTracker,
  type InputSnapshot,
  uploadInputAttachments,
} from '@channel/Input';
import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { buildPostMessageRequest } from '@channel/Input/message-payload';
import { getAttachmentKindFromFile } from '@channel/Input/utils/file-helpers';
import { hasSendableInputContent } from '@channel/Input/utils/sendable-content';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { invalidateContacts } from '@core/user/contactService';
import { getDestinationFromOptions } from '@core/util/destination';
import { throwOnErr } from '@core/util/result';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import type {
  PendingShareFile,
  UploadPendingShareFileArgs,
} from '@macro/tauri';
import { useShareTarget, useTauri } from '@macro/tauri';
import { invalidateListChannels } from '@queries/channel/channels';
import { commsServiceClient } from '@service-comms/client';
import { staticFileClient } from '@service-static-files/client';
import { isIOS } from '@solid-primitives/platform';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  ErrorBoundary,
  on,
  onCleanup,
  Show,
} from 'solid-js';

// Use the current staged file tokens as the share-session identity.
function pendingShareBatchKey(files: readonly PendingShareFile[]): string {
  return files.map((file) => file.token).join('|');
}

function normalizedSharedText(
  file: Pick<PendingShareFile, 'sharedText'>
): string {
  return file.sharedText?.trim() ?? '';
}

function pendingShareInitialText(files: readonly PendingShareFile[]): string {
  return files
    .map(normalizedSharedText)
    .filter((text) => text.length > 0)
    .join('\n');
}

function getPendingShareAttachmentKind(
  file: Pick<PendingShareFile, 'name' | 'mimeType'>
): InputAttachmentKind {
  return getAttachmentKindFromFile({
    name: file.name,
    type: file.mimeType,
  });
}

type ShareSheetAttachmentKind = Extract<InputAttachmentKind, 'image' | 'video'>;

function buildPendingAttachment(
  file: PendingShareFile,
  pendingId: string,
  kind: ShareSheetAttachmentKind
): InputAttachmentData {
  return {
    id: pendingId,
    name: file.name,
    kind,
    pending: true,
    previewSrc: kind === 'image' ? file.previewSrc : undefined,
  };
}

function buildUploadedAttachment(
  file: PendingShareFile,
  staticFileId: string,
  kind: ShareSheetAttachmentKind
): InputAttachmentData {
  return {
    id: staticFileId,
    name: file.name,
    kind,
    previewSrc: file.previewSrc,
  };
}

async function uploadPendingShareAttachment(options: {
  file: PendingShareFile;
  tracker: InputAttachmentTracker;
  uploadPendingShareFile:
    | ((args: UploadPendingShareFileArgs) => Promise<void>)
    | undefined;
  isActive: () => boolean;
}) {
  const kind = getPendingShareAttachmentKind(options.file);
  // The iOS share extension only hands the app images and videos today, and
  // this upload path only creates static-file attachments for those media types.
  if (kind === 'document') {
    toast.failure(`Can't share ${options.file.name} from iOS yet`);
    return;
  }

  const pendingId = `pending-share:${options.file.token}`;

  options.tracker.addAttachment(
    buildPendingAttachment(options.file, pendingId, kind)
  );

  try {
    const result = await throwOnErr(() =>
      staticFileClient.makePresignedUrl({
        file_name: options.file.name,
        content_type: options.file.mimeType,
      })
    );

    if (!options.uploadPendingShareFile) {
      throw new Error('Missing native shared file uploader');
    }

    await options.uploadPendingShareFile({
      token: options.file.token,
      uploadUrl: result.upload_url,
      mimeType: options.file.mimeType,
    });

    if (!options.isActive()) return;

    options.tracker.removeAttachment(pendingId);
    options.tracker.addAttachment(
      buildUploadedAttachment(options.file, result.id, kind)
    );
  } catch (error) {
    if (!options.isActive()) return;

    options.tracker.removeAttachment(pendingId);
    console.error('failed to upload iOS shared file', {
      file: options.file,
      error,
    });
    toast.failure(`Failed to upload ${options.file.name}`);
  }
}

function ShareSheetHeaderActions(props: {
  canSend: Accessor<boolean>;
  handleCancel: () => void;
  handleSend: () => void;
}) {
  return (
    <div class="shrink-0 flex items-center justify-between px-3 pb-3 text-sm font-medium text-ink min-h-11">
      <Button
        variant="ghost"
        size="sm"
        onClick={props.handleCancel}
        class="pl-0"
      >
        Cancel
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 ml-2 pl-2 disabled:text-ink-muted text-accent"
        disabled={!props.canSend()}
        onClick={(event) => {
          event.preventDefault();
          props.handleSend();
        }}
      >
        Send
      </Button>
    </div>
  );
}

function ShareSheetComposerError(_props: { error: unknown }) {
  return (
    <div class="macro-message-width flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-[5px] border border-edge-muted bg-surface px-4 py-6 text-center">
      <p class="text-sm text-ink">Couldn&apos;t load the composer.</p>
      <p class="text-xs text-ink-muted">
        Close the sheet and try sharing again.
      </p>
    </div>
  );
}

function IosShareSheetComposer(props: {
  batchKey: string;
  handleCancel: () => void;
}) {
  const shareTarget = useShareTarget();
  const userId = useUserId();
  const { all: destinationOptions } = useCombinedRecipients();
  const attachmentTracker = createInputAttachmentTracker();
  const composerId = crypto.randomUUID();
  const mentionsTracker = createMentionsTracker();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  let clearComposer = () => {};

  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);

  createEffect(
    on(
      () => props.batchKey,
      () => {
        const files = shareTarget?.pendingShareFiles() ?? [];
        if (files.length === 0) return;

        let active = true;
        onCleanup(() => {
          active = false;
        });

        void (async () => {
          await Promise.allSettled(
            files
              .filter(
                (file) =>
                  !file.isSharedText && normalizedSharedText(file).length === 0
              )
              .map((file) =>
                uploadPendingShareAttachment({
                  file,
                  tracker: attachmentTracker,
                  uploadPendingShareFile: shareTarget?.uploadPendingShareFile,
                  isActive: () => active,
                })
              )
          );
        })();
      }
    )
  );

  const resolveDestinationChannelId = async () => {
    const options = selectedOptions();

    if (options.length === 0) {
      toast.failure('Select a recipient');
      throw new Error('No recipient selected for iOS share sheet');
    }

    const destination = getDestinationFromOptions(options);

    if (destination.type === 'channel') {
      return destination.id;
    }

    if (destination.users.length === 0) {
      toast.failure('Select a valid recipient');
      throw new Error('No valid recipients selected for iOS share sheet');
    }

    const result =
      destination.users.length === 1
        ? await commsServiceClient.getOrCreateDirectMessage({
            recipient_id: destination.users[0],
          })
        : await commsServiceClient.getOrCreatePrivateChannel({
            recipients: destination.users,
          });

    if (result.isErr()) {
      toast.failure('Failed to open channel');
      throw new Error('Failed to resolve share destination channel');
    }

    return result.value.channel_id;
  };

  const handleSend = async (snapshot: InputSnapshot) => {
    const senderId = userId();
    if (!senderId) {
      toast.failure('Failed to send message');
      throw new Error('Missing sender id for iOS share sheet send');
    }

    const channelId = await resolveDestinationChannelId();
    const message = buildPostMessageRequest({ snapshot });

    const result = await commsServiceClient.postMessage({
      channel_id: channelId,
      message,
    });

    if (result.isErr()) {
      toast.failure('Failed to send message');
      throw new Error('Failed to post shared message');
    }

    invalidateListChannels();
    invalidateContacts();

    void shareTarget?.clearPendingShareFiles();
  };

  const inputState = createInputState({
    initialInput: {
      mode: 'channel',
      id: `ios-share-input-${composerId}`,
      placeholder: 'Add a message',
      value: pendingShareInitialText(shareTarget?.pendingShareFiles() ?? []),
    },
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    clearComposer: () => clearComposer(),
    attachFiles: async (files) => {
      await uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: async (file) =>
          uploadFile(file, chatRuleset, { hideProgressIndicator: true }),
      });
    },
    clearInput: () => markdownEditor.controls.clear(),
    callbacks: { onSend: handleSend },
  });

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: `ios-share-input-${composerId}`,
    enableMentions: true,
    scrollContainer,
    onMentionCreate: (mention) => {
      mentionsTracker.onMentionCreate(mention);
    },
    onMentionRemove: (mention) => {
      mentionsTracker.onMentionRemove(mention);
    },
    onChange: (markdown) => {
      inputState.setValue(markdown);
    },
    onEnter: () => {
      if (isMobile()) return false;
      void inputState.commands.send();
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      void handleFileFolderDrop(files, directories, (entries) =>
        inputState.commands.attachFiles(entries.map((entry) => entry.file))
      );
    },
    onAttachFromDisk: (files) => inputState.commands.attachFiles(files),
  });

  clearComposer = () => {
    if (isIOS) {
      markdownEditor.controls.blur();
      markdownEditor.controls.clear();
      requestAnimationFrame(() => markdownEditor.controls.focus());
    } else {
      markdownEditor.controls.clear();
    }
  };

  const canSend = () =>
    selectedOptions().length > 0 &&
    !inputState.view().hasPendingAttachments &&
    hasSendableInputContent(inputState.view());

  const handleHeaderSend = () => {
    void inputState.commands.send().catch((error) => {
      console.error('failed to send from iOS share sheet header action', error);
    });
  };

  return (
    <div class="flex h-full flex-col">
      <ErrorBoundary
        fallback={(error) => <ShareSheetComposerError error={error} />}
      >
        <ShareSheetHeaderActions
          canSend={canSend}
          handleCancel={props.handleCancel}
          handleSend={handleHeaderSend}
        />
        <MobileDrawer.Label>Recipients</MobileDrawer.Label>
        <MobileDrawer.Section>
          <div class="shrink-0 p-2">
            <RecipientSelector<'user' | 'contact' | 'channel'>
              placeholder="To: Email or group"
              setSelectedOptions={setSelectedOptions}
              selectedOptions={selectedOptions()}
              options={destinationOptions}
              triggerMode="input"
              hideBorder
              noPadding
              focusOnMount
            />
          </div>
        </MobileDrawer.Section>

        <MobileDrawer.Section class="min-h-0 flex-1 overflow-y-auto my-3">
          <Input.Root
            input={inputState.view()}
            commands={inputState.commands}
            class="bg-transparent border-none rounded-none"
          >
            <ChannelInputContainer>
              <Input.DropZone
                onDragStart={(valid) => inputState.setIsDraggedOver(valid)}
                onDragEnd={() => inputState.setIsDraggedOver(false)}
              >
                <Input.Layout>
                  <Input.DropOverlay />
                  <Input.FormatRibbon>
                    <FormatButtons
                      selectionState={() => markdownEditor.selection}
                      onInlineFormat={(format) =>
                        applyInlineFormat(markdownEditor.lexical, format)
                      }
                      onNodeFormat={(format) =>
                        applyNodeFormat(markdownEditor.lexical, format)
                      }
                    />
                  </Input.FormatRibbon>
                  <Input.EditorShell
                    ref={setScrollContainer}
                    onClick={(event) => {
                      if (!isMobile()) {
                        event.stopPropagation();
                        markdownEditor.controls.focus();
                      }
                    }}
                  >
                    <Input.Editor>
                      <MarkdownShell
                        config={markdownEditor}
                        placeholder={inputState.view().placeholder}
                        initialValue={inputState.view().value}
                        autofocus={false}
                        class="text-sm"
                      />
                    </Input.Editor>
                  </Input.EditorShell>
                  <Input.Attachments kind="media" />
                  <Input.Attachments kind="document" />
                  <Input.Footer>
                    <Input.Actions>
                      <Input.Actions.Left>
                        <Input.AttachFilesAction />
                        <Input.ToggleFormatAction />
                      </Input.Actions.Left>
                    </Input.Actions>
                  </Input.Footer>
                </Input.Layout>
              </Input.DropZone>
            </ChannelInputContainer>
          </Input.Root>
        </MobileDrawer.Section>
      </ErrorBoundary>
    </div>
  );
}

export function IosShareSheet() {
  const tauri = useTauri();
  const shareTarget = useShareTarget();

  const pendingFiles = () => shareTarget?.pendingShareFiles() ?? [];
  const shareBatchKey = () => pendingShareBatchKey(pendingFiles());
  const isOpen = () => pendingFiles().length > 0 && tauri?.os === 'ios';
  const [awaitingFirstInteraction, setAwaitingFirstInteraction] =
    createSignal(false);

  createEffect(
    on(isOpen, (open) => {
      if (!open) {
        setAwaitingFirstInteraction(false);
        return;
      }

      setAwaitingFirstInteraction(true);

      const releaseDismissGuard = () => {
        setAwaitingFirstInteraction(false);
      };

      window.addEventListener('pointerdown', releaseDismissGuard, true);
      window.addEventListener('keydown', releaseDismissGuard, true);

      onCleanup(() => {
        window.removeEventListener('pointerdown', releaseDismissGuard, true);
        window.removeEventListener('keydown', releaseDismissGuard, true);
      });
    })
  );

  const handleCancel = () => {
    void shareTarget?.clearPendingShareFiles();
  };

  return (
    <Show when={tauri?.os === 'ios'}>
      <MobileDrawer
        side="bottom"
        open={isOpen()}
        closeOnOutsidePointerStrategy="pointerdown"
        closeOnOutsideFocus={false}
        preventScroll={false}
        preventScrollbarShift={false}
        restoreFocus={false}
        noOutsidePointerEvents={false}
        onOpenChange={(open) => {
          const closeGuardActive =
            !open && isOpen() && awaitingFirstInteraction();

          if (closeGuardActive) return;

          if (!open && isOpen()) handleCancel();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay" />
          <MobileDrawer.Content aria-label="Share to Macro">
            <MobileDrawer.Handle />
            <Show when={isOpen() ? shareBatchKey() : undefined} keyed>
              {(batchKey) => (
                <IosShareSheetComposer
                  batchKey={batchKey}
                  handleCancel={handleCancel}
                />
              )}
            </Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
