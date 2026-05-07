import { useSplitLayout } from '@app/component/split-layout/layout';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import type { Completion } from '@core/client/completion';
import { generateTitle } from '@service-cognition/client';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
// import { AskAi } from '@core/component/GeneralizedPopup/AskAI';
import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import { LocationHighlight } from '@core/component/LexicalMarkdown/component/core/Highlights';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { LexicalWrapperContext } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  type EnhancedSelection,
  NODE_TRANSFORM,
  registerRootEventListener,
} from '@core/component/LexicalMarkdown/plugins';
import {
  $canConvertCheckboxesToTasks,
  CONVERT_CHECKBOXES_TO_TASKS,
  isCheckboxToTaskPluginEnabled,
} from '@core/component/LexicalMarkdown/plugins/checkbox-to-task';
import {
  HIGHLIGHT_SELECTED_NODES,
  POPUP_REPLACE_TEXT,
  popupPlugin,
  RECOMPUTE_SELECTION_RECT,
  REMOVE_HIGHLIGHT_SELECTED_NODES,
} from '@core/component/LexicalMarkdown/plugins/popup/popupPlugin';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { blockElementSignal } from '@core/signal/blockElement';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { createMarkdownFile } from '@core/util/create';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { debouncedDependent } from '@core/util/debounce';
import { getScrollParentElement } from '@core/util/scrollParent';
import type { NodeIdMappings } from '@lexical-core';
import MacroGridLoader from '@macro-icons/macro-grid-noise-loader-4.svg';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import PaperPlaneRight from '@phosphor-icons/core/fill/paper-plane-right-fill.svg?component-solid';
import CheckSquareIcon from '@phosphor-icons/core/regular/check-square.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import PencilIcon from '@phosphor-icons/core/regular/pencil.svg?component-solid';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { createCallback } from '@solid-primitives/rootless';
import {
  $getLocationUrl,
  $getSelectionLocation,
  type PersistentLocation,
} from 'core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { $getRoot, COMMAND_PRIORITY_HIGH, type RangeSelection } from 'lexical';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import { FormatTools } from './FormatTools';
import { Button } from '@ui';
import { Dynamic } from 'solid-js/web';
import { Layer } from '@ui';

const MENU_ID = 'markdown-popup';

export function MarkdownPopup(props: {
  highlightLayerRef: HTMLDivElement;
  lexicalMapping: NodeIdMappings;
}) {
  const blockId = useBlockId();

  const { editor, plugins } = useContext(LexicalWrapperContext) ?? {};
  if (!editor || !plugins) {
    console.error('MarkdownPopup mounted outside of LexicalWrapperContext!');
    return '';
  }

  const [anchorRef, setAnchorRef] = createSignal<HTMLDivElement>();
  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();

  const [popupVisible, setPopupVisible] = createMenuOpenSignal(
    MENU_ID,
    MenuPriority.Normal
  );

  const [selection, setSelection] = createSignal<EnhancedSelection | null>(
    null,
    {
      equals: () => false,
    }
  );
  const [highlightLocation, setHighlightLocation] =
    createSignal<PersistentLocation | null>(null);
  const [highlightRect, setHighlightRect] = createSignal<DOMRect | null>(null);

  plugins.use(
    popupPlugin({
      setIsPopupVisible: setPopupVisible,
      setSelection: setSelection,
    })
  );

  // The actual control value for showPopup lags.
  const showPopup = debouncedDependent(popupVisible, 100);

  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const currentUserId = useUserId();

  const [copied, setCopied] = createSignal(false);
  const [locationCopied, setLocationCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [isConverting, setIsConverting] = createSignal(false);
  const [hasCheckboxes, setHasCheckboxes] = createSignal(false);
  const { replaceOrInsertSplit } = useSplitLayout();
  let markdownRootRef!: HTMLDivElement;

  const blockElem = blockElementSignal.get;
  const [blockRect, setBlockRect] = createSignal<DOMRect>();

  createEffect(() => {
    const block = blockElem();
    if (!block) return;
    setBlockRect(block.getBoundingClientRect());
    const { observe } = makeResizeObserver(() => {
      setBlockRect(block.getBoundingClientRect());
      editor.dispatchCommand(RECOMPUTE_SELECTION_RECT, undefined);
    });
    observe(block);
  });

  const _selectedText = () => selection()?.text ?? undefined;
  const _selectedNodesText = () => selection()?.nodeText ?? undefined;
  const _selectionType = () => selection()?.type ?? undefined;

  createEffect(
    on([selection], () => {
      setLocationCopied(false);
      editor.read(() => {
        setHasCheckboxes($canConvertCheckboxesToTasks());
      });
    })
  );

  // Clean up anchorRef when popup is hidden
  onCleanup(() => {
    setAnchorRef(undefined);
  });

  // TODO (seamus) : It's kind of ugly to have find and then track these two
  // elements everywhere we need float with scroll and resize. Consider some
  // kind of abstraction to encapsulate this.
  const [scrollYOffset, setScrollYOffset] = createSignal(0);
  const [contentTopOffset, setContentTopOffset] = createSignal(0);

  autoRegister(
    editor.registerRootListener((root) => {
      if (root) {
        const blockContent = root.closest('[data-block-content]');
        if (blockContent) {
          const { observe } = makeResizeObserver(() => {
            const top = blockContent?.getBoundingClientRect().top ?? 0;
            setContentTopOffset(top);
          });
          observe(blockContent);
        }

        const scrollParent = getScrollParentElement(root);
        if (scrollParent) {
          const updateScrollY = () => {
            setScrollYOffset(scrollParent.scrollTop);
          };
          scrollParent.addEventListener('scroll', updateScrollY, {
            passive: true,
          });
          onCleanup(() => {
            scrollParent.removeEventListener('scroll', updateScrollY);
          });
        }
      }
    }),
    registerRootEventListener(editor, 'focusout', ({ relatedTarget }) => {
      if (relatedTarget && relatedTarget instanceof Node) {
        if (menuRef()?.contains(relatedTarget)) return;
      }
      setPopupVisible(false);
    }),
    editor.registerCommand(
      NODE_TRANSFORM,
      () => {
        setPopupVisible(false);
        return false;
      },
      COMMAND_PRIORITY_HIGH
    )
  );

  const MarkdownPopupToolbar = () => {
    const _isAuthenticated = useIsAuthenticated();
    const [completion, _setCompletion] = createSignal<Completion | undefined>(
      undefined
    );

    const [completionType, _setCompletionType] = createSignal<
      'explain' | 'bullet' | 'translate' | 'rewrite' | undefined
    >(undefined);

    const isGenerating = () => completion()?.status !== 'completed';

    const [inputVal, setInputVal] = createSignal('');
    const [rewriteInputRef, setRewriteInputRef] = createSignal<
      HTMLTextAreaElement | undefined
    >(undefined);

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

    const handleReplaceText = createCallback(async (newText: string) => {
      editor.dispatchCommand(POPUP_REPLACE_TEXT, newText);
      setPopupVisible(false);
    });

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

    const handleConvertToTasks = () => {
      const currentSelection = selection();
      const userId = currentUserId();
      if (!currentSelection?.lexicalSelection || !userId) {
        return;
      }

      setIsConverting(true);
      editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
        selection: currentSelection.lexicalSelection as RangeSelection,
        onComplete: (results) => {
          setIsConverting(false);
          const successCount = results.filter((r) => r.isOk()).length;
          if (successCount > 0) {
            toast.success(
              `Created ${successCount} task${successCount > 1 ? 's' : ''}`
            );
          }
          setPopupVisible(false);
        },
      });
    };

    const _contentSize = () => {
      let charCount = 0;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const text = root.getTextContent();
        charCount = text.length;
      });
      return charCount;
    };

    const handleRewrite = (_instructions: string) => {};

    createEffect(
      on([completionType, rewriteInputRef], () => {
        if (highlightLocation()) {
          return;
        }

        const inputRef = rewriteInputRef();
        if (completionType() === 'rewrite' && inputRef) {
          const location = editor.read(() => $getSelectionLocation());
          if (!location) return;

          setHighlightLocation(location);
          inputRef.focus();
        }
      })
    );

    onCleanup(() => {
      setHighlightLocation(null);
    });

    // HACK (seamus) : Would be nice to have a better way to make the
    // width of the content follow the width of the buton row without width
    // queries, but for now this works.
    let buttonRowRef!: HTMLDivElement;
    const [maxInnerWidth, setMaxInnerWidth] = createSignal(300);
    onMount(() => {
      setMaxInnerWidth(buttonRowRef.getBoundingClientRect().width);
      const observer = new ResizeObserver(() => {
        setMaxInnerWidth(buttonRowRef.getBoundingClientRect().width);
      });
      observer.observe(buttonRowRef);
      onCleanup(() => {
        observer.disconnect();
      });
    });

    const shouldShowCheckboxToTaskButton = () => {
      return (
        isCheckboxToTaskPluginEnabled(editor) &&
        hasCheckboxes() &&
        canEdit() &&
        currentUserId()
      );
    };

    return (
      <>
        <div
          class="gap-1 flex flex-row items-center flex-nowrap p-0"
          ref={buttonRowRef}
        >
          {/*<Show
						when={
							ENABLE_MARKDOWN_AI_GENERATE &&
							isAuthenticated() &&
							!!selectedText() &&
							selectionType() === "range" &&
							blockId
						}
					>
						<AskAi
							attachmentId={blockId}
							blockName="md"
							setCompletion={setCompletion}
							setCompletionType={setCompletionType}
							selectedText={selectedText()!}
							canEdit={canEdit()}
							contentSize={contentSize}
							selectedNodesText={selectedNodesText()}
							registerRewriteMethod={(fn: (instructions: string) => void) => {
								handleRewrite = fn;
							}}
						/>
					</Show>*/}
          <Show when={!isMobile() && (canEdit() || canComment())}>
            <FormatTools withinPopup />
          </Show>
          <Show when={shouldShowCheckboxToTaskButton()}>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleConvertToTasks}
              disabled={isConverting()}
            >
              <Dynamic
                component={isConverting() ? LoadingIcon : CheckSquareIcon}
                class="size-4"
              />
              {isConverting() ? 'Converting...' : 'Tasks'}
            </Button>
          </Show>
          <Button
            size="sm"
            class="px-2 text-xs rounded-xs py-1.25"
            variant="ghost"
            onClick={async () => {
              const location = editor.read(() =>
                $getLocationUrl('md', blockId)
              );
              if (!location) return;
              await navigator.clipboard.writeText(location);
              setLocationCopied(true);
              setTimeout(() => setLocationCopied(false), 2000);
            }}
          >
            <Dynamic
              component={locationCopied() ? CheckIcon : LinkIcon}
              class={locationCopied() ? 'text-success-ink size-4' : 'size-4'}
            />
            Share
          </Button>
        </div>

        <Show when={!completion() && completionType() === 'rewrite'}>
          <div class="flex flex-col border-t border-edge mt-1 pt-2 w-full">
            <p class="text-ink-muted font-medium pt-1 pl-3 text-sm">
              How would you like this text rewritten?
            </p>
            <div class="flex flex-row items-center space-x-2 w-full px-2">
              <textarea
                class="resize-none rounded-xs w-full p-2 my-3 text-sm h-max-[800px] overflow-hidden ring-1 ring-edge bg-hover"
                ref={setRewriteInputRef}
                rows={1}
                onSubmit={(e) => e.preventDefault()}
                placeholder={'Check for spelling and grammar errors'}
                onInput={(e) => {
                  setInputVal(e.currentTarget.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleRewrite(inputVal());
                  }
                }}
              />
              <button
                class="bg-transparent rounded-full hover:scale-110! transition ease-in-out delay-150 flex flex-col justify-center items-center py-1"
                onClick={() => {
                  handleRewrite(inputVal());
                }}
              >
                <PaperPlaneRight
                  width={20}
                  height={20}
                  color="var(--color-accent)"
                  class="text-accent-ink fill-accent!"
                />
              </button>
            </div>
          </div>
        </Show>

        <Show when={completion()}>
          {(completion) => (
            <div
              class="rounded-xs p-1 mt-1"
              style={{
                'overflow-wrap': 'break-word',
                width: `${maxInnerWidth()}px`,
              }}
            >
              <Show
                when={
                  completion().status !== 'loading' &&
                  completion().content.length > 0
                }
                fallback={
                  <div class="p-2 font-mono text-sm flex items-center gap-2">
                    <MacroGridLoader
                      width={20}
                      height={20}
                      class="text-accent"
                    />
                  </div>
                }
              >
                <div class="wrap-break-word p-2">
                  <ChatMessageMarkdown
                    text={completion().content}
                    generating={isGenerating}
                    rootRef={(ref: HTMLDivElement) => {
                      markdownRootRef = ref;
                    }}
                  />
                </div>
                <div class="border-t border-edge">
                  <div class="flex flex-row justify-end text-ink-muted mt-1">
                    <Show when={completionType() === 'rewrite'}>
                      {' '}
                      <div class="w-fit mr-2">
                        {' '}
                        <button
                          class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
                          onClick={() => {
                            !isLoading() &&
                              handleReplaceText(completion().content);
                          }}
                          onMouseEnter={() => {
                            editor.dispatchCommand(
                              HIGHLIGHT_SELECTED_NODES,
                              undefined
                            );
                          }}
                          onMouseLeave={() => {
                            editor.dispatchCommand(
                              REMOVE_HIGHLIGHT_SELECTED_NODES,
                              undefined
                            );
                          }}
                        >
                          {' '}
                          <Show
                            when={!isLoading() && !isGenerating()}
                            fallback={
                              <LoadingIcon class="w-3 h-3 animate-spin" />
                            }
                          >
                            {' '}
                            <PencilIcon class="w-3 h-3" />{' '}
                          </Show>{' '}
                          <p>Accept Changes</p>{' '}
                        </button>{' '}
                      </div>
                    </Show>
                    <div class="w-fit mr-2">
                      <button
                        class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
                        onClick={() => {
                          !isLoading() && handleEditInMarkdown();
                        }}
                      >
                        <Show
                          when={!isLoading() && !isGenerating()}
                          fallback={
                            <LoadingIcon class="w-3 h-3 animate-spin" />
                          }
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
                          fallback={
                            <LoadingIcon class="w-3 h-3 animate-spin" />
                          }
                        >
                          <Show
                            when={!copied()}
                            fallback={
                              <CheckIcon class="w-3 h-3 text-success" />
                            }
                          >
                            <ClipboardIcon class="w-3 h-3" />
                          </Show>
                        </Show>
                        <p>{copied() ? 'Copied!' : 'Copy'}</p>
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </>
    );
  };

  const anchorRefPosition = () => {
    const sel = selection();
    if (!showPopup()) return { left: 0, top: 0, width: 0, height: 0 };
    const currentBlockRect = blockRect();
    if (!currentBlockRect) return { left: 0, top: 0, width: 0, height: 0 };

    // if their is a highlight location then we have a rewrite in progress
    // and should pin to that.
    const hlLocation = highlightLocation();
    const hlRect = highlightRect();
    if (hlLocation && hlRect) {
      return {
        left: hlRect.left - currentBlockRect.left,
        top: hlRect.top - contentTopOffset() + untrack(scrollYOffset),
        width: hlRect.width,
        height: hlRect.height,
      };
    }

    if (!sel) return { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: sel.rect.left - currentBlockRect.left,
      top: sel.rect.top - contentTopOffset() + untrack(scrollYOffset),
      width: sel.rect.width,
      height: sel.rect.height,
    };
  };

  return (
    <>
      <ScopedPortal scope="local">
        <div
          ref={setAnchorRef}
          class="absolute pointer-events-none z-highlight-menu"
          style={{
            left: `${anchorRefPosition().left}px`,
            top: `${anchorRefPosition().top}px`,
            width: `${anchorRefPosition().width}px`,
            height: `${anchorRefPosition().height}px`,
          }}
        />
      </ScopedPortal>
      <Show when={showPopup() && anchorRef()}>
        <ScopedPortal scope="local">
          <Layer depth={2}>
            <GeneralizedPopup
              PopupComponents={MarkdownPopupToolbar}
              anchor={{
                ref: anchorRef()!,
                blockId: `${blockId}`,
                blockType: 'md',
              }}
              useBlockBoundary={true}
              ref={setMenuRef}
            />
          </Layer>
        </ScopedPortal>
      </Show>
      <Show when={highlightLocation()}>
        <LocationHighlight
          editor={editor}
          mountRef={props.highlightLayerRef}
          location={highlightLocation()!}
          mapping={props.lexicalMapping}
          padding={[0, 2]}
          class="bg-ink-extra-muted"
          captureBoundingDomRect={setHighlightRect}
        />
      </Show>
    </>
  );
}
