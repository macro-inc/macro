import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { fileDrop } from '@core/directive/fileDrop';
import TextAa from '@icon/regular/text-aa.svg';
import type { DocumentMentionInfo } from '@lexical-core';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import ArrowFatLineUp from '@phosphor-icons/core/fill/arrow-fat-line-up-fill.svg?component-solid';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { useUserId } from '@service-gql/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import { defaultSelectionData } from 'core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from 'core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { createSignal, onMount, Show } from 'solid-js';
import { type FocusableElement, tabbable } from 'tabbable';
import { handleFileUpload } from '../util/handleFileUpload';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import {
  appendItemsAsMacroMentions,
  prepareEmailBody,
} from '../util/prepareEmailBody';
import { AttachMenu } from './AttachMenu';

false && fileDrop;

export type ComposeInputData = {
  body: {
    text: string;
    html: string;
    raw: string;
  };
};

type ComposeEmailInputProps = {
  onSubmit: (data: ComposeInputData) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
};

export function ComposeEmailInput(props: ComposeEmailInputProps) {
  const [editor, setEditor] = createSignal<LexicalEditor>();

  const [isDragging, setIsDragging] = createSignal<boolean>();
  const [isPendingUpload, setIsPendingUpload] = createSignal<boolean>(false);

  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(false);
  const [attachMenuOpen, setAttachMenuOpen] = createSignal(false);

  const [content, setContent] = createSignal('');

  const panel = useSplitPanel();

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
    } else {
      tabbableEls.at(-1)?.focus();
      return true;
    }
  };

  useUserId();

  let bodyDiv!: HTMLDivElement;
  let attachButtonRef!: HTMLDivElement;

  function onAttach(items: Item[]) {
    const documentMentionItems = items.map((item) => ({
      documentId: item.id,
      documentName: item.name,
      blockName:
        item.type === 'document' ? (item.fileType as FileType) : item.type,
    }));
    appendItemsAsMacroMentions(editor(), documentMentionItems);
    items.forEach((item) => {
      makeAttachmentPublic(item.id);
    });
  }

  function onAttachDocuments(items: DocumentMentionInfo[]) {
    console.log('ComposeEmailInput: onAttachDocuments called with', items);
    console.log('ComposeEmailInput: Current editor state:', editor());
    appendItemsAsMacroMentions(editor(), items);
    items.forEach((item) => {
      makeAttachmentPublic(item.documentId);
    });
    console.log('ComposeEmailInput: Document attachments processed');
  }

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  let composeContainerRef: HTMLDivElement | undefined;

  async function handleSend() {
    const prepared = prepareEmailBody(editor());
    if (!prepared) return;

    const bodyMacro = content();

    props.onSubmit({
      body: {
        text: prepared.bodyText,
        html: prepared.bodyHtml,
        raw: bodyMacro,
      },
    });
  }

  onMount(() => {
    if (composeContainerRef) {
      attachComposeHotkeys(composeContainerRef);

      registerHotkey({
        hotkey: 'cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send email',
        keyDownHandler: () => {
          handleSend();
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: 'email.send',
        displayPriority: 10,
      });
    }
  });

  return (
    <div
      ref={(el) => {
        composeContainerRef = el;
      }}
      class="relative flex flex-col flex-1 items-center justify-between min-h-0"
    >
      <div class="w-full h-full flex flex-col overflow-hidden min-h-0">
        <Show when={showFormatRibbon()}>
          <FormatRibbon
            state={structuredClone(defaultSelectionData)}
            inlineFormat={(format: TextFormatType) => {
              editor()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            }}
            nodeFormat={(transform: NodeTransformType) => {
              editor()?.dispatchCommand(NODE_TRANSFORM, transform);
            }}
          />
        </Show>

        <div
          class="min-h-60 grow w-full h-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 overflow-auto"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileDrop={{
            onDragStart: () => setIsDragging(true),
            onDragEnd: () => setIsDragging(false),
            onDrop: async (files) => {
              handleFileUpload(files, setIsPendingUpload, (items) => {
                setIsDragging(false);
                appendItemsAsMacroMentions(editor(), items);
                items.forEach((item) => {
                  makeAttachmentPublic(item.documentId);
                });
              });
            },
          }}
        >
          <div class={`${!isDragging() && 'hidden'} absolute inset-0`}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownTextarea
            captureEditor={setEditor}
            class="text-sm break-words text-ink"
            editable={() => !props.disabled}
            placeholder="Use `@` to reference files"
            onChange={setContent}
            onFocusLeaveStart={(e) => {
              e.preventDefault();
              focusSibling('prev');
            }}
            onFocusLeaveEnd={(e) => {
              e.preventDefault();
              focusSibling('next');
            }}
            portalScope="local"
          />
        </div>
      </div>
      <div class="flex flex-row w-full h-8 justify-between items-center space-x-2 allow-css-brackets mt-2">
        <div class="flex flex-row items-center gap-2">
          <div class="relative" ref={attachButtonRef}>
            <IconButton
              theme="base"
              icon={PaperclipIcon}
              tooltip={{ label: 'Attach' }}
              disabled={props.disabled}
              onClick={() => setAttachMenuOpen(true)}
            />
            <AttachMenu
              open={attachMenuOpen()}
              close={() => setAttachMenuOpen(false)}
              anchorRef={attachButtonRef}
              containerRef={bodyDiv}
              onAttach={onAttach}
              onAttachDocuments={onAttachDocuments}
              setIsPending={setIsPendingUpload}
            />
          </div>
          <IconButton
            theme="base"
            icon={TextAa}
            disabled={props.disabled}
            onclick={() => {
              setShowFormatRibbon(!showFormatRibbon());
            }}
          />
        </div>
        <button
          type="button"
          disabled={isPendingUpload() || props.isSubmitting || props.disabled}
          onClick={() => {
            handleSend();
          }}
          class="text-ink-muted focus:scale-110 hover:scale-110 transition ease-in-out delay-150 flex gap-2 justify-center items-center hover:bg-hover py-1 px-2 text-sm"
        >
          <Show
            when={!isPendingUpload() && !props.isSubmitting}
            fallback={<Spinner class="w-5 h-5 animate-spin cursor-disabled" />}
          >
            <span class="font-medium font-mono uppercase">Send</span>
            <ArrowFatLineUp
              width={20}
              height={20}
              class="text-accent-ink fill-accent rotate-90"
            />
          </Show>
        </button>
      </div>
    </div>
  );
}
