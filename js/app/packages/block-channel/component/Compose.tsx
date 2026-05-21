import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import {
  applyInlineFormat,
  applyNodeFormat,
  buildPostMessageRequest,
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
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { isMobile } from '@core/mobile/isMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  tryMacroId,
  useDisplayName,
  type WithCustomUserInput,
} from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';

import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import InfoIcon from '@phosphor/info.svg';
import { commsServiceClient } from '@service-comms/client';
import { Surface } from '@ui';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';

export function ChannelCompose() {
  const [channelName, setChannelName] = createSignal<string>('');

  const { users: destinationOptions } = useCombinedRecipients();
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);

  const selectedRecipientCount = createMemo(() => selectedRecipients().length);

  createEffect(
    on(selectedRecipientCount, (current, prev) => {
      if (prev === 1 && current === 2) {
        setChannelName('');
      } else if (prev === 1 && current === 0) {
        setChannelName('');
      }
    })
  );

  const dmUserId = createMemo(() => {
    if (selectedRecipients().length === 1) {
      return selectedRecipients()[0].data.id;
    }
    return undefined;
  });

  const dmUserName = createMemo<() => string | undefined>(() => {
    const id = dmUserId();
    if (!id) return () => undefined;
    return useDisplayName(tryMacroId(id))[0];
  });

  const [triedToSubmit, _setTriedToSubmit] = createSignal(false);

  const previewName = createMemo(() => {
    const recipients = selectedRecipients();
    if (recipients.length === 0) {
      return 'Draft message';
    } else if (recipients.length === 1) {
      const dmName = dmUserName()();
      return dmName ? `DM with ${dmName}` : 'Draft message';
    } else {
      const names = recipients
        .slice(0, 2)
        .map((r) => {
          if (r.kind === 'user') {
            return useDisplayName(tryMacroId(r.data.id))[0]();
          }
          return r.data.email || 'Unknown';
        })
        .filter(Boolean);

      if (recipients.length > 2) {
        return `Group chat with ${names.join(', ')}, and others`;
      } else {
        return `Group chat with ${names.join(' and ')}`;
      }
    }
  });

  const [error, setError] = createSignal<string>();

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();

  async function handleSend(snapshot: InputSnapshot) {
    setError(undefined);
    const recipients = selectedRecipients();

    if (recipients.length === 0) {
      setError('Please select at least one recipient');
      throw new Error('Please select at least one recipient');
    }

    const destination = getDestinationFromOptions(recipients);
    const { content, mentions, attachments } = buildPostMessageRequest({
      snapshot,
    });

    try {
      if (
        destination.type === 'users' &&
        channelName() &&
        destination.users.length > 1
      ) {
        const res = await commsServiceClient.createChannel({
          channel_type: 'private',
          name: channelName() ?? null,
          participants: destination.users,
        });
        if (res.isErr()) {
          throw new Error('Could not create channel');
        }
        const { id } = res.value;
        await sendToChannel({
          channelId: id,
          content,
          mentions,
          attachments,
          navigate: { navigate: true, mergeHistory: true },
        });
      } else {
        await sendToUsers({
          users: destination.users,
          content,
          mentions,
          attachments,
          navigate: { navigate: true, mergeHistory: true },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
      throw e;
    }
  }

  const mentionsTracker = createMentionsTracker();
  const attachmentTracker = createInputAttachmentTracker();
  let clearComposer = () => {};

  const inputState = createInputState({
    initialInput: { mode: 'channel' as const },
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

  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: 'compose-input-markdown',
    enableMentions: true,
    scrollContainer,
    onMentionCreate: (mention) => mentionsTracker.onMentionCreate(mention),
    onMentionRemove: (mention) => mentionsTracker.onMentionRemove(mention),
    onChange: (markdown) => inputState.setValue(markdown),
    onEnter: () => {
      if (isMobile()) return false;
      void inputState.commands.send();
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      void handleFileFolderDrop(files, directories, (entries) =>
        inputState.commands.attachFiles(entries.map((e) => e.file))
      );
    },
  });
  clearComposer = () => markdownEditor.controls.clear();

  const placeholder = createMemo(() => {
    const name = channelName();
    return name ? `Send message to ${name}` : 'Send message';
  });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          class="ph-no-capture"
          label={channelName() || previewName()}
          iconType="channel"
          badges={[
            <SplitHeaderBadge text="draft" tooltip="This is a Draft Message" />,
          ]}
        />
      </SplitHeaderLeft>
      <SplitToolbarLeft>
        <div class="h-full items-center flex" p-1></div>
      </SplitToolbarLeft>
      <div class="relative flex flex-col size-full panel">
        <div class="pt-2 size-full grow overflow-y-auto @min-[40rem]:px-4">
          <div class="macro-message-width macro-message-padding mx-auto pb-1 h-full">
            <input
              type="text"
              value={channelName()}
              disabled={selectedRecipients().length < 2}
              placeholder={previewName()}
              class="text-xl font-medium mb-6 mt-12 bg-transparent border-none outline-none w-full resize-none appearance-none focus:ring-0"
              style="box-shadow: none;"
              onInput={(e) => {
                if (selectedRecipients().length >= 2) {
                  setChannelName(e.currentTarget.value);
                }
              }}
            />
            <RecipientSelector<'user' | 'contact'>
              options={destinationOptions}
              selectedOptions={selectedRecipients()}
              setSelectedOptions={setSelectedRecipients}
              placeholder="To: Macro users or email addresses"
              triedToSubmit={triedToSubmit}
              focusOnMount
            />
            <div class="mt-6 p-3 flex flex-row items-center border border-edge-muted text-ink-placeholder rounded-md">
              <InfoIcon class="shrink-0 size-8 mr-4 fill-edge" />
              <p class="text-xs">
                Send a Macro message to anyone. Share your files, tasks, emails;
                you can <code>@mention</code> anything. If your message
                recipient is not already a Macro user, they will receive an
                email letting them know they received a message on Macro.
              </p>
            </div>
          </div>
        </div>
        <Show when={error()}>
          <div class="shrink-0 w-full @min-[40rem]:px-4">
            <div class="mx-auto w-full macro-message-width macro-message-padding">
              <div class="text-sm font-mono text-failure-ink">{error()}</div>
            </div>
          </div>
        </Show>
        <div class="px-2">
          <ChannelInputContainer>
            <Input.Root
              input={inputState.view()}
              commands={inputState.commands}
            >
              <Surface
                depth={2}
                class="rounded-xl ring-1 ring-edge"
                style={{ border: '0' }}
              >
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
                          placeholder={placeholder()}
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
                        <Input.Actions.Right>
                          <Input.SendAction />
                        </Input.Actions.Right>
                      </Input.Actions>
                    </Input.Footer>
                  </Input.Layout>
                </Input.DropZone>
              </Surface>
            </Input.Root>
          </ChannelInputContainer>
        </div>
      </div>
    </>
  );
}
