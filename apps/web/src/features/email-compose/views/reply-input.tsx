import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { iosCursorScrollPlugin } from '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { ToggleButton as KToggleButton } from '@kobalte/core/toggle-button';
import DotsThree from '@phosphor/dots-three.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Trash from '@phosphor/trash.svg';
import { isIOS } from '@solid-primitives/platform';
import { Button, cn, Layer, SendButton, Surface, Tooltip } from '@ui';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { createSignal, For, onMount, Show } from 'solid-js';
import { EmailDateSelector } from '../components/email-date-selector';
import { MacroSignatureButton } from '../components/macro-signature-button';
import { SignaturePreview } from '../components/signature-preview';
import { registerToggleAppendedThread } from '../primitives/prepare-email-body';
import { getOrInitEmailFormContext } from './email-form-context';
import { ReplyEnvelope } from './reply-envelope';

false && fileFolderDrop;
false && fileSelector;

function createConfiguredEmailMarkdownEditor(options: ReplyEditorOptions) {
  const editor = buildConfig('markdown')
    .namespace(options.namespace)
    .withMentions({
      onUserMention: options.onUserMention,
      onDocumentMention: options.onDocumentMention,
    })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withMedia()
    .withCode()
    .withCheckboxToTask()
    .withRestoreFocus()
    .withSelectionData()
    .withFloatingFormatMenu()
    .use((editor) => registerToggleAppendedThread(editor))
    .onChange(options.onChange);

  if (options.onPasteFilesAndDirs) {
    editor.withFilePaste({
      onPasteFilesAndDirs: options.onPasteFilesAndDirs,
    });
  }

  if ((isIOS || isNativeMobilePlatform()) && options.scrollContainer) {
    editor.use(
      iosCursorScrollPlugin({ scrollContainer: options.scrollContainer })
    );
  }

  return editor;
}

import {
  createReplyInput,
  type ReplyEditorOptions,
  type ReplyInputProps,
} from '../primitives/reply-input';
export function ReplyInputView(props: ReplyInputProps) {
  const services = props.services;
  const ctx = props.session;
  const [isDragging, setIsDragging] = createSignal<boolean>();
  let composeContainerRef: HTMLDivElement | undefined;
  let bottomBarRef: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const state = createReplyInput(
    props,
    editor,
    { container: () => composeContainerRef, footer: () => bottomBarRef },
    getOrInitEmailFormContext
  );
  const {
    form,
    activeLinkId,
    activeInboxEmail,
    setIncludeSignature,
    setScrollContainer,
    composerExpanded,
    setComposerExpanded,
    quoteCollapsed,
    setQuoteCollapsed,
    savedDraftId,
    initialHtml,
    handleEditorConnect,
    isSending,
    isUploading,
    collectDraft,
    scheduleDraftSave,
    persistDraftOnSenderSwitch,
    hasPaidAccess,
    sendEmail,
    deleteDraftAndReset,
    handleAddAttachments,
    handleRemoveAttachment,
    handleSendTimeChange,
    sendActionHidden,
    sendActionDisabled,
    scheduleSendDisabled,
    toggleQuotedText,
  } = state;
  const isMobileDrawer = () => props.mobileDrawer !== undefined;
  const composePortalScope = () =>
    isMobileDrawer() ? ('local' as const) : undefined;
  const scrollAreaSignatureHtml = () =>
    isMobileDrawer() ? state.signatureHtml() : undefined;
  const footerSignatureHtml = () =>
    isMobileDrawer() ? undefined : state.signatureHtml();
  const editorConfig = createConfiguredEmailMarkdownEditor(state.editorOptions);
  const markdownHandle = editorConfig.buildHandle();
  setEditor(markdownHandle.lexical);
  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  useTouchOutsideToDismissKeyboard(() => composeContainerRef);

  onMount(() => {
    if (composeContainerRef) {
      attachComposeHotkeys(composeContainerRef);

      registerHotkey({
        hotkey: 'cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send email',
        keyDownHandler: () => {
          if (form().sendTime()) return false;
          sendEmail();
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.send,
        displayPriority: 9,
      });

      registerHotkey({
        hotkey: 'shift+cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send and mark done',
        keyDownHandler: () => {
          if (form().sendTime()) return false;
          sendEmail(true);
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.sendAndMarkDone,
        displayPriority: 10,
      });

      registerHotkey({
        hotkey: 'arrowup',
        scopeId: composeHotkeyScope,
        description: 'Select last message',
        runWithInputFocused: true,
        condition: () => {
          const ed = editor();
          if (!ed) return false;
          const rootEl = ed.getRootElement();
          if (!rootEl || !rootEl.contains(document.activeElement)) return false;
          return ed.read(() => {
            const text = $getRoot().getTextContent();
            return text.trim().length === 0;
          });
        },
        keyDownHandler: () => {
          const messages = ctx.messages.list();
          if (!messages?.length) return false;
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg?.db_id) return false;
          editor()?.blur();
          ctx.messages.setFocused(lastMsg.db_id);
          const msgEl = document.querySelector(
            `[data-message-body-id="${lastMsg.db_id}"]`
          ) as HTMLElement | null;
          const focusable = msgEl?.closest(
            '[tabindex="0"]'
          ) as HTMLElement | null;
          focusable?.focus();
          return true;
        },
        hotkeyToken: TOKENS.email.previousMessage,
      });

      registerHotkey({
        hotkey: 'escape',
        scopeId: composeHotkeyScope,
        description: 'Close reply',
        keyDownHandler: () => {
          const draft = collectDraft();
          const isEmpty = draft === null;

          if (isEmpty) {
            // Delete draft and close reply
            deleteDraftAndReset();
          } else {
            // Move focus back to the message
            const focusedId = ctx.messages.focusedID();
            if (focusedId) {
              const messageEl = document.querySelector(
                `[data-message-body-id="${focusedId}"]`
              ) as HTMLElement | null;
              messageEl?.focus();
            }
          }
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.cancelReply,
        displayPriority: 8,
      });
    }
  });

  const AttachmentsRow = (rowProps?: { class?: string }) => (
    <Show when={form().attachments.list().length > 0}>
      <div
        class={cn(
          'ph-no-capture shrink-0 flex gap-1 flex-wrap w-full py-2',
          rowProps?.class
        )}
      >
        <For each={form().attachments.list()}>
          {(attachment) => (
            <EmailAttachmentPill
              attachment={{
                fileName:
                  attachment.type === 'local'
                    ? attachment.file.name
                    : attachment.fileName,
                mimeType:
                  attachment.type === 'local'
                    ? attachment.file.type
                    : attachment.type === 'remote'
                      ? attachment.contentType
                      : attachment.mimeType,
              }}
              removable
              onRemove={() => handleRemoveAttachment(attachment)}
            />
          )}
        </For>
      </div>
    </Show>
  );

  const AttachButton = (buttonProps?: {
    variant?: 'ghost' | 'outline';
    class?: string;
  }) => (
    <Button
      ref={(el) =>
        fileSelector(el, () => ({
          multiple: true,
          onSelect: handleAddAttachments,
        }))
      }
      size="icon-sm"
      variant={buttonProps?.variant}
      class={buttonProps?.class}
      tooltip="Attach"
    >
      <Paperclip />
    </Button>
  );

  return (
    <Surface
      class={cn(
        'relative flex flex-col flex-1 max-w-full min-h-0',
        isMobileDrawer() && 'min-h-full overflow-y-scroll overscroll-y-none',
        props.unframed ? 'rounded-lg' : 'rounded-xl'
      )}
      style={props.unframed ? { 'background-color': 'transparent' } : undefined}
      hideBorder={props.unframed}
      ref={(el) => {
        composeContainerRef = el;
      }}
      depth={2}
      solid
    >
      <Show when={isMobileDrawer()}>
        <Layer depth={0}>
          <div
            data-corvu-no-drag=""
            class="sticky top-0 right-0 left-0 z-10 shrink-0 p-3 pt-0 flex items-center justify-between bg-surface"
          >
            <div class="flex items-center gap-1 min-w-0">
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full border border-edge-muted/70 bg-transparent"
                tooltip={savedDraftId() ? 'Delete draft' : 'Discard draft'}
                onClick={deleteDraftAndReset}
              >
                <Trash class="size-4" />
              </Button>
            </div>
            <div class="ml-auto flex items-center gap-1">
              <AttachButton
                variant="ghost"
                class="rounded-full border border-edge-muted/70 bg-transparent"
              />
              <SendButton
                disabled={sendActionDisabled() || sendActionHidden()}
                pending={isSending()}
                onClick={() => sendEmail()}
              />
            </div>
          </div>
        </Layer>
      </Show>
      <ReplyEnvelope
        fields={state.recipients}
        values={() => form().recipients()}
        options={props.session.recipientOptions}
        inboxes={services.accounts.inboxes}
        activeLinkId={activeLinkId}
        senderEmail={activeInboxEmail}
        onSenderChange={persistDraftOnSenderSwitch}
        subject={() => form().subject()}
        onSubjectChange={(subject) => {
          form().setSubject(subject);
          scheduleDraftSave();
        }}
        showSubject={!!(props.isEditingExisting || props.newMessage)}
        mobile={isMobileDrawer}
        portalScope={composePortalScope}
        replyType={state.replyType}
      />
      <div
        class={cn(
          isMobileDrawer()
            ? 'relative flex-1 flex flex-col'
            : 'size-full flex flex-col min-h-0',
          state.recipients.showExpandedRecipients() && 'mt-4'
        )}
      >
        <div
          ref={setScrollContainer}
          class={cn(
            'relative min-h-8 w-full flex flex-col placeholder:text-ink-placeholder placeholder:opacity-50 px-0 py-1',
            isMobileDrawer()
              ? 'max-h-none flex-1 overflow-visible px-5 pt-6 pb-4'
              : cn(
                  'overflow-y-auto mobile:max-h-[calc(32*var(--dvh,1dvh))]',
                  composerExpanded()
                    ? // Cap to the thread viewport (minus composer chrome) so the
                      // recipients row and send bar stay on screen together
                      'max-h-[min(calc(60*var(--dvh,1dvh)),calc(var(--thread-height,9999px)-14rem))]'
                    : 'max-h-56'
                )
          )}
          onScroll={(e) => {
            if (composerExpanded() || e.currentTarget.scrollTop <= 0) return;
            setComposerExpanded(true);
            // Keep the send bar pinned while the box grows
            requestAnimationFrame(() => {
              bottomBarRef?.scrollIntoView({ block: 'nearest' });
            });
          }}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: (valid) => setIsDragging(valid),
            onDragEnd: () => setIsDragging(false),
            onDrop: (files, directories, event) => {
              state.handleEditorDrop(files, directories, event, () =>
                setIsDragging(false)
              );
            },
          }}
        >
          <div
            class={cn('absolute size-full inset-0', !isDragging() && 'hidden')}
          >
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownShell
            config={editorConfig}
            class={cn(
              'ph-no-capture cursor-text wrap-break-word text-ink h-auto overflow-visible',
              isMobileDrawer() ? 'text-[17px] leading-6' : 'text-sm',
              // Quoted thread collapses behind the "⋯" pill below
              // (rule lives in LexicalMarkdown/styles.css — Tailwind arbitrary
              // variants turn the underscore in .macro_quote into a space)
              quoteCollapsed() && 'quote-collapsed',
              isDragging() && 'blur'
            )}
            disabled={isSending()}
            initialValue={initialHtml() ? undefined : props.preloadedBody}
            placeholder={
              isMobileDrawer()
                ? 'Use `@` to reference files'
                : 'Reply — @mention to share or cc people'
            }
            portalScope={isMobileDrawer() ? 'local' : 'split'}
            refFn={(el) => props.markdownDomRef?.(el)}
            onConnect={handleEditorConnect}
          />
          <Show when={!hasPaidAccess()}>
            <div class="text-ink/50 mt-[1lh]" data-watermark>
              <MacroSignatureButton
                visible={!services.viewerLoading() && !services.hasPaidAccess()}
                onUpgrade={services.onUpgrade}
              />
            </div>
          </Show>
          <Show when={isMobileDrawer()}>
            <AttachmentsRow />
          </Show>
          <Show when={scrollAreaSignatureHtml()}>
            {(html) => (
              <SignaturePreview
                mobile={services.isMobile()}
                prepareLinks={services.prepareSignatureLinks}
                html={html()}
                onDismiss={() => {
                  // Dismissal is composer-local state worth keeping — latch
                  // the seed so a draft upgrade can't remount it away.
                  props.onEngaged?.();
                  setIncludeSignature(false);
                }}
              />
            )}
          </Show>
        </div>
        {/* Quoted-text controls live below the scroll area so they stay
            anchored to the composer bottom instead of scrolling with (and
            floating over) tall content. */}
        <Show when={form().replyAppended() && quoteCollapsed()}>
          <div class="shrink-0 flex items-center pt-1" data-corvu-no-drag="">
            <Button
              variant="ghost"
              size="icon-sm"
              class="rounded-md text-ink-extra-muted hover:text-ink-muted hover:bg-active"
              tooltip="Show quoted text"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                setQuoteCollapsed(false);
                setComposerExpanded(true);
              }}
            >
              <DotsThree />
            </Button>
          </div>
        </Show>
        <Show
          when={
            props.replyingTo() &&
            // The collapse pill above already covers this state
            !(form().replyAppended() && quoteCollapsed())
          }
        >
          <div
            class="shrink-0 pt-1"
            data-corvu-no-drag=""
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip
              label={
                form().replyAppended() ? 'Hide quoted text' : 'Show quoted text'
              }
            >
              <KToggleButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                class="size-5 rounded bg-transparent p-0 text-ink-extra-muted hover:text-ink-muted [&_:where(svg)]:size-5"
                pressed={form().replyAppended()}
                onChange={toggleQuotedText}
              >
                <DotsThree />
              </KToggleButton>
            </Tooltip>
          </div>
        </Show>
        <Show when={!isMobileDrawer()}>
          {/* Below the scroll area so quoted email content can never overlap it */}
          <AttachmentsRow class="px-4" />
          <Show when={footerSignatureHtml()}>
            {(html) => (
              <SignaturePreview
                mobile={services.isMobile()}
                prepareLinks={services.prepareSignatureLinks}
                html={html()}
                onDismiss={() => {
                  // Dismissal is composer-local state worth keeping — latch
                  // the seed so a draft upgrade can't remount it away.
                  props.onEngaged?.();
                  setIncludeSignature(false);
                }}
              />
            )}
          </Show>
          {/* No fixed height: the send button (size-7.5) is taller than the icon
              buttons, and a fixed h-9 minus the vertical padding left it 4px short
              — with items-end it bled upward over the signature bar above. */}
          <div
            ref={bottomBarRef}
            class="shrink-0 flex flex-row w-full justify-between items-end space-x-2 px-0 pb-0 pt-1.5"
          >
            <div class="flex flex-row items-center gap-1">
              <div class="relative flex">
                <AttachButton />
              </div>

              <Button
                onclick={deleteDraftAndReset}
                tooltip={savedDraftId() ? 'Delete draft' : 'Discard'}
                size="icon-sm"
              >
                <Trash />
              </Button>
            </div>

            <div class="flex flex-row items-center gap-1">
              <Show when={services.scheduleEnabled && !sendActionHidden()}>
                <EmailDateSelector
                  mobile={services.isMobile()}
                  sendTime={form().sendTime() ?? null}
                  onSendTimeChange={handleSendTimeChange}
                  disabled={scheduleSendDisabled()}
                  disablePortal={services.isTouch()}
                />
              </Show>
              <SendButton
                disabled={isUploading() || isSending() || !!form().sendTime()}
                pending={isSending()}
                hidden={sendActionHidden()}
                onClick={() => sendEmail()}
              />
            </div>
          </div>
        </Show>
      </div>
    </Surface>
  );
}
