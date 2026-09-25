import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { isInlineMediaFileName } from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { Telemetry } from '@macro-inc/observability';
import { cn, Scroll } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { createAttachmentViewer } from '../components/attachment-viewer';
import { MacroSignatureButton } from '../components/macro-signature-button';
import { useCompose } from '../context/compose-context';
import type { DraftFormAttachment } from '../primitives/email-form-state';
import { addUserMentionToCc } from '../primitives/mention-to-cc';

false && fileFolderDrop;

export function ComposeBody(props: {
  debugName?: string;
  inputRef?: (el: HTMLDivElement) => void;
  mobileScrollRef?: Accessor<HTMLElement | undefined>;
  onAddFiles?: (files: File[]) => void;
}) {
  const ctx = useCompose();
  const attachmentViewer = createAttachmentViewer();

  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [isDragging, setIsDragging] = createSignal<boolean>();

  let bodyDiv!: HTMLDivElement;

  const logComposeBody = (event: string, details?: Record<string, unknown>) => {
    if (!props.debugName) return;
    Telemetry.info(`[ComposeBody] ${event}`, {
      debugName: props.debugName,
      ...details,
    });
  };

  const captureEditor = (ed: LexicalEditor) => {
    logComposeBody('captureEditor called');
    setEditor(ed);
    ctx.captureEditor(ed);
  };

  logComposeBody('mounted', {
    initialHtmlLength: ctx.initialHtml()?.length ?? 0,
    initialMarkdownLength: ctx.initialMarkdown?.()?.length ?? 0,
  });

  onCleanup(() => {
    logComposeBody('unmounted');
  });

  createEffect(
    on(
      () => ctx.initialMarkdown?.(),
      (next, prev) => {
        logComposeBody('initialMarkdown changed', {
          nextLength: next?.length ?? 0,
          previousLength: prev?.length ?? 0,
        });
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => ctx.initialHtml(),
      (next, prev) => {
        logComposeBody('initialHtml changed', {
          nextLength: next?.length ?? 0,
          previousLength: prev?.length ?? 0,
        });
      },
      { defer: true }
    )
  );

  return (
    <>
      <div class="size-full min-h-0 sm:max-h-full touch:flex-1 flex flex-col flex-1">
        <div
          class="grow size-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 overflow-hidden relative [&_.text-ink-placeholder]:left-0 [&_.text-ink-placeholder>p]:my-0"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: (valid) => setIsDragging(valid),
            onDragEnd: () => setIsDragging(false),
            onDrop: (files, dirs, event) => {
              const ed = editor();
              const media =
                ed && event
                  ? files.filter((file) => isInlineMediaFileName(file.name))
                  : [];
              if (ed && media.length > 0) {
                ctx.bodyActions.insertFiles(ed, {
                  files: media,
                  directories: [],
                  dropEvent: event,
                  onVideos: props.onAddFiles,
                });
              }
              const attachments = files.filter((file) => !media.includes(file));
              if (attachments.length === 0 && dirs.length === 0) return;
              ctx.bodyActions.readDroppedFiles(attachments, dirs, (files) =>
                props.onAddFiles?.(files)
              );
            },
          }}
        >
          <div class={cn('absolute inset-0', !isDragging() && 'hidden')}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>

          <Scroll>
            <MarkdownTextarea
              autoLinkMatchMode="common-tlds"
              floatingFormatMenu
              domRef={props.inputRef}
              captureEditor={captureEditor}
              onInitialized={ctx.onEditorInitialized}
              scrollRef={props.mobileScrollRef}
              initialHtml={ctx.initialHtml()}
              initialValue={ctx.initialMarkdown?.()}
              class="text-base wrap-break-word text-ink h-auto overflow-visible"
              editable={() => !ctx.disabled()}
              placeholder="Use `@` to reference files"
              watermark={
                !ctx.hasPaidAccess() ? (
                  <MacroSignatureButton
                    visible={!ctx.viewerLoading?.()}
                    onUpgrade={ctx.onUpgrade}
                  />
                ) : undefined
              }
              onChange={ctx.onContentChange}
              onUserMention={(mention) => {
                addUserMentionToCc({
                  mention,
                  recipientOptions: ctx.recipientOptions(),
                  toRecipients: ctx.recipients().to,
                  ccRecipients: ctx.recipients().cc,
                  bccRecipients: ctx.recipients().bcc,
                  onRecipientAdded: ctx.bodyActions.recipientAdded,
                  setCc: (next) => ctx.setRecipients('cc', next),
                });
              }}
              onFocusLeaveStart={(e) => {
                if (!ctx.bodyActions.focusSibling) return;
                e.preventDefault();
                ctx.bodyActions.focusSibling('prev');
              }}
              onFocusLeaveEnd={(e) => {
                if (!ctx.bodyActions.focusSibling) return;
                e.preventDefault();
                ctx.bodyActions.focusSibling('next');
              }}
              portalScope="local"
              onPasteFilesAndDirs={(files, directories) => {
                const ed = editor();
                if (!ed) return;
                ctx.bodyActions.insertFiles(ed, {
                  files,
                  directories,
                  onVideos: props.onAddFiles,
                });
              }}
            />
          </Scroll>
        </div>
        {ctx.signaturePreview?.()}
        <div class="flex flex-wrap items-center gap-2">
          <For each={ctx.attachments()}>
            {(attachment) => (
              <AttachmentItem
                attachment={attachment}
                onOpen={attachmentViewer.onClickFor(attachment)}
              />
            )}
          </For>
        </div>
        <attachmentViewer.Viewer />
      </div>
      <Show when={ctx.validationError('no_message')}>
        {(err) => <div class="text-failure-ink mt-1">{err().message}</div>}
      </Show>
    </>
  );
}

function AttachmentItem(props: {
  attachment: DraftFormAttachment;
  onOpen?: () => void;
}) {
  const ctx = useCompose();

  const handleRemove = () => {
    ctx.onRemoveAttachment(props.attachment);
  };

  return (
    <Switch>
      <Match when={props.attachment.type === 'local' && props.attachment}>
        {(attachment) => (
          <EmailAttachmentPill
            attachment={{
              fileName: attachment().file.name,
              mimeType: attachment().file.type,
            }}
            removable
            onRemove={handleRemove}
            onClick={props.onOpen}
          />
        )}
      </Match>
      <Match when={props.attachment.type === 'remote' && props.attachment}>
        {(attachment) => (
          <EmailAttachmentPill
            attachment={{
              fileName: attachment().fileName,
              mimeType: attachment().contentType,
            }}
            removable
            onRemove={handleRemove}
            onClick={props.onOpen}
          />
        )}
      </Match>
      <Match when={props.attachment.type === 'forwarded' && props.attachment}>
        {(attachment) => (
          <EmailAttachmentPill
            attachment={{
              fileName: attachment().fileName,
              mimeType: attachment().mimeType,
            }}
            removable
            onRemove={handleRemove}
            onClick={props.onOpen}
          />
        )}
      </Match>
    </Switch>
  );
}
