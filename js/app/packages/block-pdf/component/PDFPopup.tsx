import type { IHighlight } from '@block-pdf/model/Highlight';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { generateTitle } from '@service-cognition/client';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
// import { AskAi } from '@core/component/GeneralizedPopup/AskAI';
import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import { blockElementSignal } from '@core/signal/blockElement';
import { createMarkdownFile } from '@core/util/create';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat-teardrop.svg?component-solid';
import PasteIcon from '@phosphor-icons/core/regular/clipboard-text.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import TrashIcon from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { createCallback } from '@solid-primitives/rootless';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import {
  PDFPopupCompletionSignal,
  PDFPopupSelectedTextSignal,
} from './PageOverlay';

type PDFPopupProps = {
  highlightProps: {
    /** highlight the current selection */
    highlight: () => void;
    /** remove the highlight you're on */
    removeHighlight: () => void;
    /** are we currently on a highlight */
    currentHighlight?: IHighlight;
    /** can edit the current highlight */
    canEdit: boolean;
    /** can create a new highlight */
    canCreate: boolean;
  };
  commentProps: {
    /** place a comment on the current selection */
    placeComment: (e: MouseEvent) => void;
    /** can edit the current highlight to add a comment */
    canEdit: boolean;
    /** can create a new highlight comment */
    canCreate: boolean;
  };
  shareLinkProps?: {
    /** share the currently selected region of the document */
    share: () => void;
  };
  aiProps?: {
    attachmentId: string;
  };
  insertProps?: {
    insertText: (text: string) => void;
  };
  /** where to anchor the popup */
  anchorRef: HTMLElement;
};

// SCUFFED styling: how do we want to handle this color?
function HighlightIcon() {
  return (
    <div class="w-4 h-4 bg-[oklch(0.905_0.182_98.111)] rounded-full"></div>
  );
}

function LoadingContent(props: { lines: number }) {
  return (
    <div class="flex flex-col justify-center items-start w-full py-2">
      <For each={Array.from({ length: props.lines })}>
        {() => (
          <div class="bg-edge/70 animate-pulse rounded-md h-2 mb-2 w-full" />
        )}
      </For>
      <div class="bg-edge/70 animate-pulse rounded-md h-2 mb-2 w-[65%]" />
    </div>
  );
}

export function PDFPopup(props: PDFPopupProps) {
  const _isAuthenticated = useIsAuthenticated();

  const blockId = useBlockId();
  const [completion, _setCompletion] = PDFPopupCompletionSignal;
  const isGenerating = () => completion()?.status !== 'completed';

  const [copied, setCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  let markdownRootRef!: HTMLDivElement;

  const width = () => (completion() === undefined ? 'w-auto' : '600px');

  const { replaceOrInsertSplit } = useSplitLayout();

  createEffect(() => {
    const currentSelection = window.getSelection()?.toString();
    if (currentSelection && currentSelection.length > 0) {
      PDFPopupSelectedTextSignal.set(currentSelection);
    }
  });

  const _selectedText = createMemo(() => {
    const currentSelection = PDFPopupSelectedTextSignal();
    if (currentSelection && currentSelection.length > 0) {
      return currentSelection;
    }
    return props.highlightProps.currentHighlight?.text;
  });

  const handleCopy = async () => {
    const cleanedText = completion()?.content;
    if (!cleanedText) {
      return;
    }
    const html = markdownRootRef?.outerHTML ?? null;
    if (!html) {
      try {
        await navigator.clipboard.writeText(cleanedText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      return;
    }

    const clipboardItem = new ClipboardItem({
      'text/plain': new Blob([cleanedText], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    });
    let written = false;
    // try rich and plain first. Not avail in all browsers and contexts.
    try {
      await navigator.clipboard.write([clipboardItem]);
      written = true;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}

    if (!written) {
      try {
        await navigator.clipboard.writeText(cleanedText);
        written = true;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  };

  const name = useBlockDocumentName();
  const handleEditInMarkdown = createCallback(async () => {
    setIsLoading(true);
    const content = completion()?.content;
    if (!content) {
      return;
    }

    const title = await generateTitle(content);
    const documentId = await createMarkdownFile({
      content,
      title: title ?? `${name()} - AI Explanation`,
    });

    if (!documentId) {
      console.error('Error opening AI message in Notes');
      setIsLoading(false);
      return;
    }

    replaceOrInsertSplit({
      type: 'md',
      id: documentId,
    });
    setIsLoading(false);
  });

  onMount(() => {
    const handler = (e: MouseEvent) => {
      e.stopPropagation();
    };

    const blockElement = blockElementSignal();
    if (blockElement) {
      blockElement.addEventListener('selectionchange', handler, {
        capture: true,
      });
    }

    onCleanup(() => {
      if (blockElement) {
        blockElement.removeEventListener('selectionchange', handler, {
          capture: true,
        });
      }
    });
  });

  const PDFPopupToolbar = () => {
    const [locationCopied, setLocationCopied] = createSignal(false);
    return (
      <>
        <div class="flex flex-row items-center space-x-2 justify-between w-full">
          {/*<Show when={isAuthenticated() && !!selectedText() && props.aiProps}>
						{(aiProps) => (
							<AskAi
								attachmentId={aiProps().attachmentId}
								blockName="pdf"
								setCompletion={setCompletion}
								selectedText={selectedText()!}
							/>
						)}
					</Show>*/}
          <div class="flex flex-row space-x-2 items-center">
            <Show when={completion() && props.insertProps}>
              {(insertProps) => (
                <DeprecatedIconButton
                  theme="clear"
                  icon={PasteIcon}
                  onClick={() =>
                    insertProps().insertText(completion()!.content)
                  }
                  title="Insert AI response"
                />
              )}
            </Show>

            <Switch>
              <Match when={!props.highlightProps.currentHighlight}>
                <Show when={props.highlightProps.canCreate}>
                  <DeprecatedIconButton
                    theme="clear"
                    icon={HighlightIcon}
                    onClick={() => {
                      props.highlightProps.highlight();
                    }}
                  />
                </Show>
              </Match>
              <Match when={props.highlightProps.currentHighlight}>
                <Show when={props.highlightProps.canEdit}>
                  <DeprecatedIconButton
                    theme="clear"
                    icon={TrashIcon}
                    onClick={() => {
                      props.highlightProps.removeHighlight();
                    }}
                  />
                </Show>
              </Match>
            </Switch>

            <Show
              when={
                props.highlightProps.currentHighlight
                  ? props.commentProps.canEdit
                  : props.commentProps.canCreate
              }
            >
              <DeprecatedIconButton
                theme="clear"
                icon={ChatIcon}
                onClick={(e: MouseEvent | KeyboardEvent) =>
                  props.commentProps.placeComment(e as MouseEvent)
                }
              />
            </Show>
          </div>
          <Show when={props.shareLinkProps}>
            {(shareLinkProps) => (
              <DeprecatedTextButton
                theme="clear"
                icon={
                  locationCopied()
                    ? () => <CheckIcon class="text-success size-4" />
                    : LinkIcon
                }
                text={locationCopied() ? 'Copied' : 'Share'}
                onClick={() => {
                  setLocationCopied(true);
                  shareLinkProps().share();
                }}
              />
            )}
          </Show>
        </div>

        <Show when={completion()}>
          {(completion) => (
            <div
              class="flex flex-col items-center space-x-2 w-full px-2 border-t border-edge mt-1"
              style={{
                width: width(),
              }}
            >
              <Show
                when={
                  completion().status !== 'loading' &&
                  completion().content.length > 0
                }
                fallback={<LoadingContent lines={4} />}
              >
                <div class="w-full max-w-full overflow-hidden">
                  <ChatMessageMarkdown
                    text={completion().content}
                    generating={isGenerating}
                    rootRef={(ref: HTMLDivElement) => {
                      markdownRootRef = ref;
                    }}
                  />
                </div>
              </Show>
              <div class="w-full border-t-1 border-edge">
                <div class="flex flex-row w-full justify-end text-ink-muted mt-1">
                  <div class="w-fit mr-2">
                    <button
                      class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
                      onClick={() => {
                        !isLoading() && handleEditInMarkdown();
                      }}
                    >
                      <Show
                        when={!isLoading() && !isGenerating()}
                        fallback={<LoadingIcon class="w-3 h-3 animate-spin" />}
                      >
                        <NotesIcon class="w-3 h-3 text-note" />
                      </Show>
                      <p>Edit in Notes</p>
                    </button>
                  </div>
                  <div class="w-fit">
                    <button
                      class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
                      onClick={handleCopy}
                    >
                      <Show
                        when={!isGenerating()}
                        fallback={<LoadingIcon class="w-3 h-3 animate-spin" />}
                      >
                        <Show
                          when={!copied()}
                          fallback={<CheckIcon class="w-3 h-3 text-success" />}
                        >
                          <ClipboardIcon class="w-3 h-3" />
                        </Show>
                      </Show>
                      <p>{copied() ? 'Copied!' : 'Copy'}</p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
      </>
    );
  };

  return (
    <GeneralizedPopup
      PopupComponents={PDFPopupToolbar}
      anchor={{
        ref: props.anchorRef,
        blockId: `${blockId}`,
        blockType: 'pdf',
      }}
    />
  );
}
