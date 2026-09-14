import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
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
            onDrop: (files, dirs) => {
              ctx.bodyActions.readDroppedFiles(files, dirs, (files) =>
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
              class="text-sm wrap-break-word text-ink h-auto overflow-visible"
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
                if (ed) ctx.bodyActions.pasteFiles(ed, files, directories);
              }}
            />
          </Scroll>
        </div>
        {ctx.signaturePreview?.()}
        <div class="flex flex-wrap items-center gap-2">
          <For each={ctx.attachments()}>
            {(attachment) => <AttachmentItem attachment={attachment} />}
          </For>
        </div>
      </div>
      <Show when={ctx.validationError('no_message')}>
        {(err) => <div class="text-failure-ink mt-1">{err().message}</div>}
      </Show>
    </>
  );
}

function AttachmentItem(props: { attachment: DraftFormAttachment }) {
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
          />
        )}
      </Match>
    </Switch>
  );
}
