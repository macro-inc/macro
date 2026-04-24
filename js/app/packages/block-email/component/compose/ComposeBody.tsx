import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { createFilesReadyHandler } from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { logger } from '@observability/logger';
import { cn } from '@ui/utils/classname';
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
import type { FocusableElement } from 'tabbable';
import { tabbable } from 'tabbable';
import { makeAttachmentPublic } from '../../util/makeAttachmentPublic';
import { useCompose } from './ComposeContext';

false && fileFolderDrop;

export function ComposeBody(props: {
  debugName?: string;
  inputRef?: (el: HTMLDivElement) => void;
  mobileScrollRef?: Accessor<HTMLElement | undefined>;
  onAddFiles?: (files: File[]) => void;
}) {
  const ctx = useCompose();
  const panel = useSplitPanel();

  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [isDragging, setIsDragging] = createSignal<boolean>();

  const focusSibling = (direction: 'next' | 'prev') => {
    const panelRef = panel?.panelRef();
    if (!panelRef) return;
    const tabbableEls = tabbable(panelRef);
    const activeEl = document.activeElement;
    const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);
    if (activeElIndex > -1) {
      const ndx = activeElIndex + (direction === 'next' ? 1 : -1);
      if (ndx < 0 || ndx >= tabbableEls.length) return false;
      const prevEl = tabbableEls[ndx];
      if (!prevEl) return false;
      prevEl.focus();
      return true;
    }
    tabbableEls.at(-1)?.focus();
    return true;
  };

  const onAddFilesAndDirs = (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => {
    const editor_ = editor();
    if (!editor_) return;

    handleFileFolderDrop(
      files,
      directories,
      createFilesReadyHandler(
        editor_,
        undefined,
        undefined,
        undefined,
        (uploadedItemIds) => {
          uploadedItemIds.forEach((itemId) => {
            makeAttachmentPublic(itemId);
          });
        },
        { width: 542, height: 542 }
      )
    );
  };

  let bodyDiv!: HTMLDivElement;

  const logComposeBody = (event: string, details?: Record<string, unknown>) => {
    if (!props.debugName) return;
    logger.log(`[ComposeBody] ${event}`, {
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
      <div class="w-full h-full min-h-0 sm:max-h-full mobile:flex-1 flex flex-col flex-1">
        <div
          class="grow w-full h-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 overflow-auto"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: (valid) => setIsDragging(valid),
            onDragEnd: () => setIsDragging(false),
            onDrop: (files, dirs) => {
              handleFileFolderDrop(files, dirs, (u) =>
                props.onAddFiles?.(u.map((f) => f.file))
              );
            },
          }}
        >
          <div class={cn('absolute inset-0', !isDragging() && 'hidden')}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>

          <MarkdownTextarea
            domRef={props.inputRef}
            captureEditor={captureEditor}
            scrollRef={props.mobileScrollRef}
            initialHtml={ctx.initialHtml()}
            initialValue={ctx.initialMarkdown?.()}
            class="text-sm wrap-break-word text-ink mobile:overflow-auto h-auto"
            editable={() => !ctx.disabled()}
            placeholder="Use `@` to reference files"
            watermark={
              !ctx.hasPaidAccess() ? <MacroSignatureButton /> : undefined
            }
            onChange={ctx.onContentChange}
            onFocusLeaveStart={(e) => {
              e.preventDefault();
              focusSibling('prev');
            }}
            onFocusLeaveEnd={(e) => {
              e.preventDefault();
              focusSibling('next');
            }}
            portalScope="local"
            onPasteFilesAndDirs={onAddFilesAndDirs}
          />
        </div>
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
