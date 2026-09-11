import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { applyAiOps } from '@block-md/ai-edit/applyAiOps';
import {
  activeCommentThreadSignal,
  highlightedCommentThreadsSignal,
} from '@block-md/comments/commentStore';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useBlockId } from '@core/block';
import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import { PopupPositioner } from '@core/component/GeneralizedPopup/PopupPositioner';
import { LocationHighlight } from '@core/component/LexicalMarkdown/component/core/Highlights';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { LexicalWrapperContext } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  $getConvertibleListFromSelection,
  autoRegister,
  type EnhancedSelection,
  INSERT_LINK_COMMAND,
  LIST_TO_TABLE_COMMAND,
  NODE_TRANSFORM,
  normalizeLinkUrl,
  registerRootEventListener,
} from '@core/component/LexicalMarkdown/plugins';
import {
  $canConvertCheckboxesToTasks,
  CONVERT_CHECKBOXES_TO_TASKS,
  isCheckboxToTaskPluginEnabled,
} from '@core/component/LexicalMarkdown/plugins/checkbox-to-task';
import {
  $getMarkIdsAtCaret,
  CREATE_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import {
  $getLocationUrl,
  $getSelectionLocation,
  type PersistentLocation,
} from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import {
  popupPlugin,
  RECOMPUTE_SELECTION_RECT,
} from '@core/component/LexicalMarkdown/plugins/popup/popupPlugin';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_MARKDOWN_COMMENTS,
  enableInlineAiEditing,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  readNativePasteboardText,
  setNativeEditMenuSuppressed,
} from '@core/mobile/nativeEditMenu';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { debouncedDependent } from '@core/util/debounce';
import { getScrollParentElement } from '@core/util/scrollParent';
import type { NodeIdMappings } from '@macro-inc/lexical-core';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import ArrowUp from '@phosphor/arrow-up.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import GridIcon from '@phosphor/grid-four.svg';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import SparkleIcon from '@phosphor-icons/core/bold/sparkle-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import CheckSquareIcon from '@phosphor-icons/core/regular/check-square.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import {
  cancelAiEdit,
  hasActiveAiEdit,
  requestAiEdit,
} from '@service-ai-editing/client';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { Button, Toolbar } from '@ui';
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  type RangeSelection,
} from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FormatTools } from './FormatTools';
import { TouchSelectionToolbar } from './TouchSelectionToolbar';

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
  // The selected range, painted with the accent highlight whenever the prompt
  // box holds focus (focusing it drops the native selection paint) and kept on
  // as the loading indicator while an edit session runs.
  const [aiEditLocation, setAiEditLocation] =
    createSignal<PersistentLocation | null>(null);
  const [aiEditRunning, setAiEditRunning] = createSignal(false);
  const [aiInputFocused, setAiInputFocused] = createSignal(false);
  // On touch devices the AI-edit instruction is typed in a drawer instead of
  // the popup's inline input; the drawer outlives the popup.
  const [aiEditDrawerOpen, setAiEditDrawerOpen] = createSignal(false);
  const [aiEditInput, setAiEditInput] = createSignal('');

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAiEdit(blockId);
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  // Derive the highlight from the selection at the point it's set, rather
  // than mirroring it reactively; an in-flight edit keeps it alive past the
  // popup (see the onCleanup below).
  const setSelectionAndHighlight = (value: EnhancedSelection | null) => {
    setSelection(value);
    setAiEditLocation(editor.read(() => $getSelectionLocation()));
  };

  plugins.use(
    popupPlugin({
      setIsPopupVisible: setPopupVisible,
      setSelection: setSelectionAndHighlight,
      // On touch, a caret touching a commented range shows the toolbar so
      // its "Show comment" can open the thread — tapping a highlight no
      // longer opens it directly.
      $allowEmptySelection: (lexicalSelection) => {
        if (!isTouchDevice()) return false;
        return (
          $getMarkIdsAtCaret(
            lexicalSelection.anchor.getNode(),
            lexicalSelection.anchor.offset
          ) != null
        );
      },
    })
  );

  // The actual control value for showPopup lags.
  const showPopup = debouncedDependent(popupVisible, 100);

  // Keep the native iOS selection menu from stacking on top of the popup;
  // the popup carries copy/cut/paste itself while suppression is active.
  createEffect(() => {
    setNativeEditMenuSuppressed(popupVisible());
  });
  onCleanup(() => {
    setNativeEditMenuSuppressed(false);
  });

  const canEdit = useCanEdit();
  const inlineAiEditing = useFeatureFlag(enableInlineAiEditing);
  const canComment = useCanComment();
  const currentUserId = useUserId();

  const highlightedCommentThreads = highlightedCommentThreadsSignal.get;
  const setActiveCommentThread = activeCommentThreadSignal.set;

  const [locationCopied, setLocationCopied] = createSignal(false);
  const [isConverting, setIsConverting] = createSignal(false);
  const [hasCheckboxes, setHasCheckboxes] = createSignal(false);
  const [convertibleListKey, setConvertibleListKey] = createSignal<
    string | null
  >(null);

  const _selectedText = () => selection()?.text ?? undefined;
  const _selectedNodesText = () => selection()?.nodeText ?? undefined;
  const _selectionType = () => selection()?.type ?? undefined;

  createEffect(
    on([selection], () => {
      setLocationCopied(false);
      editor.read(() => {
        setHasCheckboxes($canConvertCheckboxesToTasks());
        setConvertibleListKey(
          $getConvertibleListFromSelection()?.getKey() ?? null
        );
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
  const [portalScopeRect, setPortalScopeRect] = createSignal<DOMRect>();

  autoRegister(
    editor.registerRootListener((root) => {
      if (root) {
        const blockContent = root.closest('[data-block-content]');
        const portalScope = root.closest<HTMLElement>('.portal-scope');

        const updateGeometry = () => {
          setContentTopOffset(blockContent?.getBoundingClientRect().top ?? 0);
          setPortalScopeRect(portalScope?.getBoundingClientRect());
          editor.dispatchCommand(RECOMPUTE_SELECTION_RECT, undefined);
        };

        if (blockContent) {
          const { observe } = makeResizeObserver(updateGeometry);
          observe(blockContent);
        }
        if (portalScope && portalScope !== blockContent) {
          const { observe } = makeResizeObserver(updateGeometry);
          observe(portalScope);
        }
        updateGeometry();

        const scrollParent = getScrollParentElement(root);
        if (scrollParent) {
          const updateScrollY = () => {
            setScrollYOffset(scrollParent.scrollTop);
          };
          updateScrollY();
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

  // Resolves the loro-mirror node ids of every top-level block touched by
  // the selection, via the nodeIdPlugin's node state / key mapping.
  const resolveSelectedNodeIds = (): string[] => {
    const lexicalSelection = selection()?.lexicalSelection;
    if (!lexicalSelection) return [];
    return editor.read(() => {
      const topNodes = new Set(
        lexicalSelection
          .getNodes()
          .map((node) => node.getTopLevelElement() ?? node)
      );
      const ids = new Set<string>();
      for (const node of topNodes) {
        const id =
          $getId(node) ??
          props.lexicalMapping.nodeKeyToIdMap.get(node.getKey());
        if (id) ids.add(id);
      }
      return [...ids];
    });
  };

  // Shared by the desktop toolbar's inline AI row and the touch AI drawer:
  // the autosizing prompt input and its submit-or-stop button.
  const handleAiInput = (
    e: InputEvent & { currentTarget: HTMLTextAreaElement }
  ) => {
    setAiEditInput(e.currentTarget.value);
    e.currentTarget.style.height = 'auto';
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
  };

  const AiEditSubmitButton = () => (
    <Show
      when={hasActiveAiEdit(blockId)}
      fallback={
        <Button
          size="icon-sm"
          class="rounded-full"
          variant="strong"
          tooltip="Send"
          disabled={!aiEditInput().trim()}
          onClick={handleAiEditSubmit}
        >
          <ArrowUp class="size-4" />
        </Button>
      }
    >
      <Button
        size="icon-sm"
        class="rounded-full"
        depth={3}
        variant="ghost"
        tooltip="Stop AI edit"
        onClick={() => cancelAiEdit(blockId)}
      >
        <div class="size-2.5 rounded-xs bg-current" />
      </Button>
    </Show>
  );

  const handleAiEditSubmit = () => {
    if (aiEditRunning()) return;
    const instruction = aiEditInput().trim();
    if (!instruction) return;
    const nodeIds = resolveSelectedNodeIds();
    if (nodeIds.length === 0) {
      toast.failure('Could not resolve the selected nodes');
      return;
    }
    // The highlight is already tracking the selection; flagging the run
    // keeps it alive (as the loading indicator) after the popup closes.
    setAiEditRunning(true);
    // Apply ops locally so the edit lands in this client's undo stack.
    requestAiEdit({
      documentId: blockId,
      prompt: `Request: ${instruction}\nUser is selecting nodes ${nodeIds.join(' ')}. Proceed with requested edit`,
      onOps: (ops) => applyAiOps(editor, props.lexicalMapping, ops),
    })
      .then((result) => {
        if (result === 'failed') toast.failure('AI edit failed');
      })
      .finally(() => {
        setAiEditLocation(null);
        setAiEditRunning(false);
      });
    setAiEditInput('');
    setAiEditDrawerOpen(false);
    setPopupVisible(false);
  };

  // Selection actions shared by the desktop and touch toolbars.
  const shouldShowCheckboxToTaskButton = () => {
    return Boolean(
      isCheckboxToTaskPluginEnabled(editor) &&
        hasCheckboxes() &&
        canEdit() &&
        currentUserId()
    );
  };

  const shouldShowTableButton = () =>
    Boolean(canEdit() && convertibleListKey());

  const shouldShowEditWithAiButton = () =>
    inlineAiEditing().enabled && canEdit();

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

  const handleConvertListToTable = () => {
    const listKey = convertibleListKey();
    if (!listKey) return;
    const converted = editor.dispatchCommand(LIST_TO_TABLE_COMMAND, listKey);
    if (converted) setPopupVisible(false);
  };

  const handleShare = async () => {
    const location = editor.read(() => $getLocationUrl('md', blockId));
    if (!location) return;
    await navigator.clipboard.writeText(location);
    // Desktop gets the inline check-icon flip; on touch the toolbar is
    // small and easily dismissed, so confirm with a toast as well.
    if (isTouchDevice()) toast.success('Link copied to clipboard');
    setLocationCopied(true);
    setTimeout(() => setLocationCopied(false), 2000);
  };

  const handleInsertComment = () => {
    const created = editor.dispatchCommand(
      CREATE_DRAFT_COMMENT_COMMAND,
      undefined
    );
    if (!created) {
      toast.failure('Please highlight text to comment.');
      return;
    }
    setPopupVisible(false);
  };

  const handlePaste = async () => {
    // Reading the pasteboard is async, and the toolbar tap or the native call
    // can move or drop the editor selection before it resolves. Snapshot the
    // range now and restore it before inserting so the text lands where the
    // user had selected.
    const savedSelection = editor.read(() => {
      const current = $getSelection();
      return $isRangeSelection(current) ? current.clone() : null;
    });
    const text = await readNativePasteboardText();
    if (!text) return;
    editor.update(() => {
      if (savedSelection) $setSelection(savedSelection);
      const lexicalSelection = $getSelection();
      if ($isRangeSelection(lexicalSelection)) {
        lexicalSelection.insertRawText(text);
      }
    });
    setPopupVisible(false);
  };

  const handleShowComment = () => {
    // Viewing a thread doesn't take text input, and the caret kept the
    // editor focused (the toolbar preserves the selection) — close the
    // virtual keyboard. Blurring alone is not enough: a retained
    // editor-state selection is re-applied to the DOM on the next lexical
    // update, which refocuses the editor and brings the keyboard back, so
    // clear the selection first.
    editor.update(() => $setSelection(null));
    editor.blur();
    const [threadId] = highlightedCommentThreads();
    if (threadId != null) setActiveCommentThread(threadId);
    setPopupVisible(false);
  };

  const handleOpenAiEditDrawer = () => {
    setAiEditDrawerOpen(true);
    setPopupVisible(false);
  };

  const MarkdownPopupToolbar = () => {
    let savedLinkSelection: RangeSelection | null = null;
    const [activePrompt, setActivePrompt] = createSignal<
      'none' | 'ai' | 'link'
    >('none');
    const [linkInput, setLinkInput] = createSignal('');

    // Track the toolbar's rendered width so a prompt that replaces it keeps the
    // same footprint instead of snapping to its own content width.
    const [toolbarWidth, setToolbarWidth] = createSignal<number>();
    const measureToolbar = (el: HTMLDivElement) => {
      const update = () => setToolbarWidth(el.getBoundingClientRect().width);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    };

    onCleanup(() => {
      setHighlightLocation(null);
    });

    // Snapshot the selection before the link input steals focus so the URL can
    // be applied to the original range on submit.
    const handleRequestLink = () => {
      savedLinkSelection = editor.read(() => {
        const current = $getSelection();
        return $isRangeSelection(current) ? current.clone() : null;
      });
      setActivePrompt('link');
    };

    const handleInsertLink = () => {
      const input = linkInput().trim();
      const url = normalizeLinkUrl(input);
      if (!url) return;
      const linkText = selection()?.text ?? input;
      editor.update(() => {
        if (savedLinkSelection) $setSelection(savedLinkSelection);
      });
      editor.dispatchCommand(INSERT_LINK_COMMAND, { url, linkText });
      setLinkInput('');
      setActivePrompt('none');
      setPopupVisible(false);
    };

    // Escape dismisses the input and refocuses the editor so the selection is
    // preserved (and never reaches lexical's own escape handling).
    const dismissPrompt = () => {
      setActivePrompt('none');
      setLinkInput('');
      setAiEditInput('');
      editor.focus();
    };

    return (
      <Show
        when={activePrompt() !== 'none'}
        fallback={
          <Toolbar ref={measureToolbar}>
            {/* Selection actions: AI edit + convert to tasks. */}
            <Show when={shouldShowEditWithAiButton()}>
              <Toolbar.Button
                size="sm"
                depth={3}
                onClick={() => setActivePrompt('ai')}
              >
                AI edit
              </Toolbar.Button>
            </Show>
            <Show when={shouldShowCheckboxToTaskButton()}>
              <Toolbar.Button
                size="sm"
                depth={3}
                onClick={handleConvertToTasks}
                disabled={isConverting()}
              >
                <Dynamic
                  component={isConverting() ? LoadingIcon : CheckSquareIcon}
                  class="size-4"
                />
                {isConverting() ? 'Converting...' : 'Tasks'}
              </Toolbar.Button>
            </Show>
            <Show
              when={
                shouldShowEditWithAiButton() || shouldShowCheckboxToTaskButton()
              }
            >
              <Toolbar.Divider />
            </Show>

            <Show when={canEdit()}>
              <FormatTools withinPopup onRequestLink={handleRequestLink} />
              <Toolbar.Divider />
            </Show>

            <Show when={shouldShowTableButton()}>
              <Toolbar.Button
                size="sm"
                depth={3}
                tooltip="Convert list to table"
                onClick={handleConvertListToTable}
              >
                <GridIcon class="size-4" />
                Table
              </Toolbar.Button>
              <Toolbar.Divider />
            </Show>
            <Show when={ENABLE_MARKDOWN_COMMENTS && canComment()}>
              <Toolbar.Button
                size="icon-sm"
                depth={3}
                onClick={handleInsertComment}
                tooltip="Comment"
                label="Comment"
              >
                <ChatTeardrop />
              </Toolbar.Button>
            </Show>
            <Toolbar.Button
              size="icon-sm"
              depth={3}
              onClick={() => void handleShare()}
              tooltip="Copy link to snippet"
              label="Copy link to snippet"
            >
              <Dynamic
                component={locationCopied() ? CheckIcon : LinkIcon}
                class={locationCopied() ? 'text-success-ink size-4' : 'size-4'}
              />
            </Toolbar.Button>
          </Toolbar>
        }
      >
        <Toolbar
          class="gap-2"
          style={{
            width: toolbarWidth() ? `${toolbarWidth()}px` : undefined,
          }}
        >
          <Show
            when={activePrompt() === 'link'}
            fallback={
              <textarea
                class="grow resize-none overflow-hidden bg-transparent pl-2 text-sm placeholder:text-ink-placeholder focus:outline-none"
                rows={1}
                placeholder="Describe changes"
                ref={(el) => {
                  requestAnimationFrame(() => el.focus());
                }}
                onFocus={() => setAiInputFocused(true)}
                onBlur={() => setAiInputFocused(false)}
                onInput={handleAiInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAiEditSubmit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    dismissPrompt();
                  }
                }}
              />
            }
          >
            <input
              type="text"
              class="h-6 grow bg-transparent pl-2 text-sm placeholder:text-ink-placeholder focus:outline-none"
              placeholder="Paste or insert link"
              value={linkInput()}
              ref={(el) => {
                requestAnimationFrame(() => el.focus());
              }}
              onInput={(e) => setLinkInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleInsertLink();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  dismissPrompt();
                }
              }}
            />
          </Show>
          <Show when={activePrompt() === 'ai'}>
            <AiEditSubmitButton />
          </Show>
          <Show when={activePrompt() === 'link'}>
            <Button
              size="icon-sm"
              class="rounded-full"
              variant="strong"
              tooltip="Insert link"
              disabled={!linkInput().trim()}
              onClick={handleInsertLink}
            >
              <CheckIcon class="size-4" />
            </Button>
          </Show>
        </Toolbar>
      </Show>
    );
  };

  // Picks the toolbar for the device and owns the popup-lifetime cleanup
  // shared by both: the AI-edit highlight survives the popup only while the
  // drawer or a running edit has taken it over.
  const PopupToolbar = () => {
    onCleanup(() => {
      if (!aiEditRunning() && !aiEditDrawerOpen()) setAiEditLocation(null);
    });
    return (
      <Show
        when={isTouchDevice()}
        fallback={
          <PopupPositioner
            anchor={anchorRef()!}
            useBlockBoundary
            ref={setMenuRef}
          >
            <MarkdownPopupToolbar />
          </PopupPositioner>
        }
      >
        <GeneralizedPopup
          anchor={{
            ref: anchorRef()!,
            blockId: `${blockId}`,
            blockType: 'md',
          }}
          useBlockBoundary={true}
          ref={setMenuRef}
        >
          <TouchSelectionToolbar
            canEdit={canEdit()}
            canComment={canComment()}
            isConverting={isConverting()}
            hasSelection={(selection()?.text ?? '') !== ''}
            showTasksOption={shouldShowCheckboxToTaskButton()}
            showTableOption={shouldShowTableButton()}
            showEditWithAiOption={shouldShowEditWithAiButton()}
            showOpenCommentOption={highlightedCommentThreads().length > 0}
            locationCopied={locationCopied()}
            setPopupVisible={setPopupVisible}
            onConvertToTasks={handleConvertToTasks}
            onConvertListToTable={handleConvertListToTable}
            onOpenComment={handleShowComment}
            onShare={() => void handleShare()}
            onInsertComment={handleInsertComment}
            onPaste={() => void handlePaste()}
            onEditWithAi={handleOpenAiEditDrawer}
          />
        </GeneralizedPopup>
      </Show>
    );
  };

  const anchorRefPosition = () => {
    const sel = selection();
    const currentPortalScopeRect = portalScopeRect();
    if (!showPopup() || !currentPortalScopeRect) return undefined;

    // if their is a highlight location then we have a rewrite in progress
    // and should pin to that.
    const hlLocation = highlightLocation();
    const hlRect = highlightRect();
    if (hlLocation && hlRect) {
      return {
        left: hlRect.left - currentPortalScopeRect.left,
        top: hlRect.top - contentTopOffset() + untrack(scrollYOffset),
        width: hlRect.width,
        height: hlRect.height,
      };
    }

    if (!sel) return undefined;
    return {
      left: sel.rect.left - currentPortalScopeRect.left,
      top: sel.rect.top - contentTopOffset() + untrack(scrollYOffset),
      width: sel.rect.width,
      height: sel.rect.height,
    };
  };

  const anchorPosition = createMemo(anchorRefPosition);

  return (
    <>
      <Show when={anchorPosition()}>
        {(position) => (
          <ScopedPortal scope="local">
            <div
              ref={setAnchorRef}
              class="absolute pointer-events-none"
              style={{
                left: `${position().left}px`,
                top: `${position().top}px`,
                width: `${position().width}px`,
                height: `${position().height}px`,
              }}
            />
          </ScopedPortal>
        )}
      </Show>
      <Show when={showPopup() && anchorRef()}>
        <ScopedPortal scope="local">
          <PopupToolbar />
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
      <Show
        when={
          (aiInputFocused() || aiEditRunning() || aiEditDrawerOpen()) &&
          aiEditLocation()
        }
      >
        <style>{`
          .ai-edit-highlight {
            background-color: color-mix(in oklab, var(--color-ink) 5%, transparent);
            border-radius: 3px;
          }
          @keyframes ai-edit-swipe {
            0% { background-position: 150% 0; }
            100% { background-position: -50% 0; }
          }
          .ai-edit-highlight-running {
            background-image: linear-gradient(
              100deg,
              transparent 40%,
              color-mix(in oklab, var(--color-ink) 9%, transparent) 50%,
              transparent 60%
            );
            background-size: 250% 100%;
            background-repeat: no-repeat;
            animation: ai-edit-swipe 1.6s ease-in-out infinite;
          }
        `}</style>
        <LocationHighlight
          editor={editor}
          mountRef={props.highlightLayerRef}
          location={aiEditLocation()!}
          mapping={props.lexicalMapping}
          padding={[0, 2]}
          class={
            aiEditRunning()
              ? 'ai-edit-highlight ai-edit-highlight-running'
              : 'ai-edit-highlight'
          }
        />
      </Show>
      <Show when={isTouchDevice()}>
        <MobileDrawer
          side="bottom"
          open={aiEditDrawerOpen()}
          onOpenChange={(open: boolean) => {
            if (open) return;
            setAiEditDrawerOpen(false);
            if (!aiEditRunning()) setAiEditLocation(null);
          }}
          closeOnOutsidePointerStrategy="pointerdown"
          preventScroll={false}
          preventScrollbarShift={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content aria-label="Edit with AI">
              <MobileDrawer.Handle class="pb-1" />
              <div class="flex items-center gap-2 px-4 pb-3">
                <SparkleIcon class="size-4 shrink-0 text-ink-extra-muted" />
                <textarea
                  class="grow resize-none bg-transparent py-1.5 text-sm placeholder:text-ink-placeholder focus:outline-none"
                  rows={1}
                  placeholder="Describe changes"
                  value={aiEditInput()}
                  ref={(el) => {
                    requestAnimationFrame(() => el.focus());
                  }}
                  onInput={handleAiInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAiEditSubmit();
                    }
                  }}
                />
                <AiEditSubmitButton />
              </div>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </>
  );
}
