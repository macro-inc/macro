import {
  applyInlineFormat,
  applyNodeFormat,
  createConfiguredChannelMarkdownEditor,
  createInputAttachmentTracker,
  createInputState,
  createMentionsTracker,
  FormatButtons,
  Input,
  type InputSnapshot,
  uploadInputAttachments,
} from '@channel/Input';
import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { buildPostMessageRequest } from '@channel/Input/message-payload';
import { hasSendableInputContent } from '@channel/Input/utils/sendable-content';
import {
  createMessageRecipients,
  postToExistingChannel,
} from '@channel/message-recipients';
import { ConfirmDrawer } from '@components/app/mobile/ConfirmDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import type { PendingShareFile } from '@macro/tauri';
import { useShareTarget, useTauri } from '@macro/tauri';
import { usePrepareSharedMediaMutation } from '@queries/channel/share-upload';
import { isIOS } from '@solid-primitives/platform';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  ErrorBoundary,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createNativeShareSend } from './createNativeShareSend';
import { uploadPendingShareAttachment } from './uploadPendingShareAttachment';

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

function NativeShareSheetComposer(props: { handleCancel: () => void }) {
  const shareTarget = useShareTarget();
  const batchTokens = (shareTarget?.pendingShareFiles() ?? []).map(
    (file) => file.token
  );
  const attachmentTracker = createInputAttachmentTracker();
  const prepareMedia = usePrepareSharedMediaMutation();
  const composerId = crypto.randomUUID();
  const mentionsTracker = createMentionsTracker();
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const userId = useUserId();
  const { sendToChannel, resolvePeopleChannel } = useSendMessageToPeople();
  let clearComposer = () => {};

  // The new-message composer's To field: people, or one existing channel.
  const recipients = createMessageRecipients();

  const [failedFiles, setFailedFiles] = createSignal<PendingShareFile[]>([]);
  const [uploading, setUploading] = createSignal(false);
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const uploadSharedFiles = async (files: PendingShareFile[]) => {
    if (uploading()) return;
    setUploading(true);
    const failed: PendingShareFile[] = [];
    // Bound simultaneous native uploads and retain failures for an explicit retry.
    for (const file of files) {
      if (!active) break;
      const result = await uploadPendingShareAttachment({
        file,
        tracker: attachmentTracker,
        prepareMedia: prepareMedia.mutateAsync,
        uploadPendingShareFile: shareTarget?.uploadPendingShareFile,
        isActive: () => active,
      });
      if (result === 'failed') failed.push(file);
    }
    if (active) {
      setFailedFiles(failed);
      setUploading(false);
    }
  };
  onMount(() => {
    fireAndForget(
      uploadSharedFiles(
        (shareTarget?.pendingShareFiles() ?? []).filter(
          (file) =>
            !file.isSharedText && normalizedSharedText(file).length === 0
        )
      ),
      'native-share-sheet'
    );
  });

  const sendShare = createNativeShareSend<InputSnapshot>({
    clear: async () => {
      await shareTarget?.clearPendingShareFiles(batchTokens);
    },
    send: async (snapshot) => {
      if (uploading() || failedFiles().length > 0) {
        throw new Error(
          'Finish uploading the shared attachments before sending'
        );
      }
      // Without a sender the post never runs, so nothing else would say so.
      if (!userId()) {
        toast.failure('Failed to send message');
        throw new Error('Missing sender id for native share sheet send');
      }
      const options = recipients.selected();
      if (options.length === 0) {
        toast.failure('Select a recipient');
        throw new Error('No recipient selected for native share sheet');
      }
      const destination = getDestinationFromOptions(options);
      const { content, mentions, attachments } = buildPostMessageRequest({
        snapshot,
      });

      if (destination.type === 'users' && destination.users.length === 0) {
        toast.failure('Select a valid recipient');
        throw new Error('No valid recipients selected for native share sheet');
      }
      // Finding or creating the people's conversation shows its own failure.
      const channelId =
        destination.type === 'channel'
          ? destination.id
          : await resolvePeopleChannel(destination.users);
      if (!channelId) {
        throw new Error('Could not open the conversation for this share');
      }

      // The share stays on the current view: the sheet closes once it's sent.
      // A failed post shows the send mutation's own toast; throwing keeps the
      // draft.
      await postToExistingChannel(sendToChannel, {
        span: 'channels.share_sheet_send',
        channelId,
        content,
        mentions,
        attachments,
      });
    },
  });

  const inputState = createInputState({
    initialInput: {
      mode: 'channel',
      id: `native-share-input-${composerId}`,
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
    callbacks: { onSend: sendShare.send },
  });

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: `native-share-input-${composerId}`,
    resolveAppLink: useMacroMentionLinkResolver(),
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
      fireAndForget(inputState.commands.send(), 'native-share-sheet');
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      fireAndForget(
        handleFileFolderDrop(files, directories, (entries) =>
          inputState.commands.attachFiles(entries.map((entry) => entry.file))
        ),
        'native-share-sheet'
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
    sendShare.canSend() &&
    !uploading() &&
    failedFiles().length === 0 &&
    recipients.selected().length > 0 &&
    !inputState.view().hasPendingAttachments &&
    hasSendableInputContent(inputState.view());

  const handleHeaderSend = () => {
    void inputState.commands.send().catch((error) => {
      console.error(
        'failed to send from native share sheet header action',
        error
      );
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
        <Show when={failedFiles().length > 0}>
          <div
            role="alert"
            class="mx-6 mb-3 flex items-center justify-between gap-3 text-sm text-failure"
          >
            <span>{failedFiles().length} attachment(s) couldn't upload.</span>
            <Button
              variant="ghost"
              disabled={uploading()}
              onClick={() =>
                fireAndForget(
                  uploadSharedFiles(failedFiles()),
                  'native-share-sheet'
                )
              }
            >
              {uploading() ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        </Show>
        <MobileDrawer.Label>Recipients</MobileDrawer.Label>
        <MobileDrawer.Section>
          <div class="shrink-0 p-2">
            <RecipientSelector<'user' | 'contact' | 'agent' | 'channel'>
              placeholder="To: People, channels, or email addresses"
              setSelectedOptions={recipients.select}
              selectedOptions={recipients.selected()}
              createSource={recipients.createSource}
              full={recipients.isFull()}
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
                  <Input.Layout.Body>
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
                    <Input.Layout.Editor
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
                    </Input.Layout.Editor>
                    <Input.Attachments kind="media" />
                    <Input.Attachments kind="document" />
                  </Input.Layout.Body>
                  <Input.Layout.ActionsLeft>
                    <Input.AttachNativeMediaAction />
                    <Input.ToggleFormatAction />
                  </Input.Layout.ActionsLeft>
                </Input.Layout>
              </Input.DropZone>
            </ChannelInputContainer>
          </Input.Root>
        </MobileDrawer.Section>
      </ErrorBoundary>
    </div>
  );
}

export function NativeShareSheet() {
  const tauri = useTauri();
  const shareTarget = useShareTarget();
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);

  const pendingFiles = () => shareTarget?.pendingShareFiles() ?? [];
  const shareBatchKey = () => pendingShareBatchKey(pendingFiles());
  const isOpen = () =>
    pendingFiles().length > 0 &&
    (tauri?.os === 'ios' || tauri?.os === 'android');
  const [awaitingFirstInteraction, setAwaitingFirstInteraction] =
    createSignal(false);

  createEffect(
    on(isOpen, (open) => {
      if (!open) {
        setConfirmDiscard(false);
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
    setConfirmDiscard(false);
    fireAndForget(shareTarget?.clearPendingShareFiles(), 'native-share-sheet');
  };

  return (
    <Show when={tauri?.os === 'ios' || tauri?.os === 'android'}>
      <MobileDrawer
        side="bottom"
        open={isOpen()}
        closeOnOutsidePointerStrategy="pointerdown"
        closeOnOutsideFocus={false}
        preventScroll={false}
        preventScrollbarShift={false}
        restoreFocus={false}
        noOutsidePointerEvents={false}
        // Dismissing discards the shared files on iOS, without asking.
        keepOpenOnNavigation
        onOpenChange={(open) => {
          const closeGuardActive =
            !open && isOpen() && awaitingFirstInteraction();

          if (closeGuardActive) return;

          if (!open && isOpen()) {
            if (tauri?.os === 'android') setConfirmDiscard(true);
            else handleCancel();
          }
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Share to Macro" targetHeight={80}>
            <MobileDrawer.Handle />
            {/* Keyed on the batch so each incoming share remounts the composer. */}
            <Show when={isOpen() ? shareBatchKey() : undefined} keyed>
              {(_batchKey) => (
                <NativeShareSheetComposer handleCancel={handleCancel} />
              )}
            </Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <ConfirmDrawer
        open={confirmDiscard()}
        onOpenChange={setConfirmDiscard}
        title="Discard this share?"
        body="Your message and shared attachments will be removed."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          handleCancel();
        }}
      />
    </Show>
  );
}
