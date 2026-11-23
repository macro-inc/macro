import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import { ComposerSurface } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createInputAttachmentTracker } from './attachment-tracker';
import { ChannelInputContainer } from './ChannelInputContainer';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputState } from './create-input-state';
import { FormatButtons } from './FormatButtons';
import { Input } from './Input';
import { createMentionsTracker } from './mentions-tracker';
import type { InputSnapshot } from './types';
import { uploadInputAttachments } from './upload-attachments';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';

/**
 * The composer for a conversation that doesn't exist yet: the Draft message
 * page and a DM that its first message will create. `onSend` makes the
 * conversation and sends; an error it throws is shown above the composer and
 * keeps the draft.
 */
export function DraftComposer(props: {
  placeholder: string;
  autofocus?: boolean;
  onSend: (snapshot: InputSnapshot) => Promise<void>;
}) {
  const [layout, setLayout] = createSignal<HTMLDivElement>();
  const [error, setError] = createSignal<string>();

  const handleSend = async (snapshot: InputSnapshot) => {
    setError(undefined);
    try {
      await props.onSend(snapshot);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Failed to send message'
      );
      throw sendError;
    }
  };

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

  const send = async () => {
    try {
      await inputState.commands.send();
    } catch (sendError) {
      // `handleSend` shows its own failures above the composer and rethrows.
      if (error()) return;
      setError('Failed to send message');
      Telemetry.error(sendError, { surface: 'channel-compose' });
    }
  };

  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: 'compose-input-markdown',
    resolveAppLink: useMacroMentionLinkResolver(),
    enableMentions: true,
    scrollContainer,
    onMentionCreate: (mention) => mentionsTracker.onMentionCreate(mention),
    onMentionRemove: (mention) => mentionsTracker.onMentionRemove(mention),
    onChange: (markdown) => inputState.setValue(markdown),
    onEnter: () => {
      if (isTouchDevice()) return false;
      fireAndForget(send(), 'channel-compose');
      return true;
    },
    sendMessage: () => fireAndForget(send(), 'channel-compose'),
    onPasteFilesAndDirs: (files, directories) => {
      fireAndForget(
        handleFileFolderDrop(files, directories, (entries) =>
          inputState.commands.attachFiles(entries.map((e) => e.file))
        ),
        'channel-compose'
      );
    },
  });
  clearComposer = () => markdownEditor.controls.clear();
  const { isCompact: oneLineInput } = createComposerLayout(
    markdownEditor.buildHandle().lexical,
    {
      container: layout,
      mode: () =>
        inputState.view().showFormatRibbon ||
        inputState.view().attachments?.length
          ? 'expanded'
          : 'auto',
    }
  );

  return (
    // Full-frame mobile: error + composer float in the bottom accessory
    // region above the dock; desktop renders them inline.
    <FloatRegionOrInline region="accessory">
      <Show when={error()}>
        <div class="shrink-0 w-full @min-[40rem]:px-4 touch:px-(--mobile-chrome-gutter)">
          <div class="mx-auto w-full macro-message-width macro-message-padding">
            <div class="text-sm font-mono text-failure-ink">{error()}</div>
          </div>
        </div>
      </Show>
      {/* ChannelInputContainer owns the mobile chrome gutter, so drop the
          desktop px-2 there. */}
      <div class="px-2 touch:px-0">
        <ChannelInputContainer>
          <Input.Root input={inputState.view()} commands={inputState.commands}>
            <ComposerSurface>
              <Input.DropZone
                onDragStart={(valid) => inputState.setIsDraggedOver(valid)}
                onDragEnd={() => inputState.setIsDraggedOver(false)}
              >
                <Input.Layout ref={setLayout} oneLineInput={oneLineInput()}>
                  <Input.DropOverlay />
                  <Input.Layout.Body>
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
                      on:click={(event) => {
                        if (!isTouchDevice()) {
                          event.stopPropagation();
                          markdownEditor.controls.focus();
                        }
                      }}
                    >
                      <Input.Editor>
                        <ComposerEditor
                          config={markdownEditor}
                          placeholder={props.placeholder}
                          autofocus={props.autofocus ?? false}
                          class="text-base"
                        />
                      </Input.Editor>
                    </Input.Layout.Editor>
                    <Input.Attachments kind="media" />
                    <Input.Attachments kind="document" />
                  </Input.Layout.Body>

                  <Input.Layout.ActionsLeft>
                    <Show
                      when={!isPlatform('ios')}
                      fallback={<Input.AttachNativeMediaAction />}
                    >
                      <Input.AttachFilesAction />
                    </Show>
                  </Input.Layout.ActionsLeft>
                  <Input.Layout.ActionsRight>
                    <Input.SendAction />
                  </Input.Layout.ActionsRight>
                </Input.Layout>
              </Input.DropZone>
            </ComposerSurface>
          </Input.Root>
        </ChannelInputContainer>
      </div>
    </FloatRegionOrInline>
  );
}
