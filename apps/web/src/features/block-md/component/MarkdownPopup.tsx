import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { applyAiOps } from '@block-md/ai-edit/applyAiOps';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
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
  $extractTitleFromNode,
  $getSelectedCheckboxes,
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
  serializePersistentLocation,
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
import { trackMention, untrackMention } from '@core/signal/mention';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { getScrollParentElement } from '@core/util/scrollParent';
import CheckIcon from '@icon/system/bold/check-bold.svg?component-solid';
import SparkleIcon from '@icon/system/bold/sparkle-bold.svg?component-solid';
import LoadingIcon from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import ChatTeardrop from '@icon/system/regular/chat-teardrop.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg?component-solid';
import GridIcon from '@icon/system/regular/grid-four.svg';
import LinkIcon from '@icon/system/regular/link.svg?component-solid';
import {
  $createDocumentMentionNode,
  buildMentionMarkdownString,
  type NodeIdMappings,
} from '@macro-inc/lexical-core';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { Telemetry } from '@macro-inc/observability';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { Button, SendButton, Toolbar } from '@ui';
import {
  $createTextNode,
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
import { URL_PARAMS } from '../constants';
import { useMarkdownDocument } from '../context/markdown-document-context';
import {
  cancelAiEdit,
  hasActiveAiEdit,
  requestAiEditWithToast,
} from '../queries/ai-edit';
import {
  $insertAtSavedPoint,
  type SavedPoint,
} from '../util/insertAtSavedPoint';
import type { ComposeTaskSuccess } from './ComposeTask';
import { FormatTools } from './FormatTools';
import { TouchSelectionToolbar } from './TouchSelectionToolbar';

const MENU_ID = 'markdown-popup';
export function MarkdownPopup(props: {
  highlightLayerRef: HTMLDivElement;
  lexicalMapping: NodeIdMappings;
}) {
  const { documentId, permissions, state, persistedName, fallbackName } =
    useMarkdownDocument();
  const { canEdit, canComment } = permissions;
  const { comments: commentState, setCommentState } = state;
  const blockId = documentId();

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

  const inlineAiEditing = useFeatureFlag(enableInlineAiEditing);
  const currentUserId = useUserId();

  const [locationCopied, setLocationCopied] = createSignal(false);
  const [convertibleListKey, setConvertibleListKey] = createSignal<
    string | null
  >(null);
  const [selectedCheckboxCount, setSelectedCheckboxCount] = createSignal(0);
  const [isConverting, setIsConverting] = createSignal(false);

  const _selectedText = () => selection()?.text ?? undefined;
  const _selectedNodesText = () => selection()?.nodeText ?? undefined;
  const _selectionType = () => selection()?.type ?? undefined;

  createEffect(
    on([selection], () => {
      setLocationCopied(false);
      editor.read(() => {
        setConvertibleListKey(
          $getConvertibleListFromSelection()?.getKey() ?? null
        );
        const lexicalSelection = $getSelection();
        // Empty items create no task, so they don't count toward "N tasks".
        setSelectedCheckboxCount(
          $isRangeSelection(lexicalSelection)
            ? $getSelectedCheckboxes(lexicalSelection).filter(
                $extractTitleFromNode
              ).length
            : 0
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
        <SendButton
          disabled={!aiEditInput().trim()}
          onClick={handleAiEditSubmit}
        />
      }
    >
      <Button
        size="icon-sm"
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
    // Fast mode: one model edits the whole document directly, no supervisor.
    // Apply ops locally so the edit lands in this client's undo stack.
    fireAndForget(
      requestAiEditWithToast(
        {
          documentId: blockId,
          prompt: `Request: ${instruction}\nUser is selecting nodes ${nodeIds.join(' ')}. Proceed with requested edit`,
          mode: 'fast',
          onOps: (ops) => applyAiOps(editor, props.lexicalMapping, ops),
        },
        () => {
          setAiEditLocation(null);
          setAiEditRunning(false);
        }
      ),
      'markdown-ai-edit'
    );
    setAiEditInput('');
    setAiEditDrawerOpen(false);
    setPopupVisible(false);
  };

  // Selection actions shared by the desktop and touch toolbars.
  const shouldShowCreateTaskButton = () =>
    Boolean(currentUserId() && selection()?.text);

  // A selection spanning several checklist items makes one task per item.
  const convertsCheckboxes = () =>
    canEdit() &&
    isCheckboxToTaskPluginEnabled(editor) &&
    selectedCheckboxCount() > 1;

  const createTaskLabel = () => {
    if (isConverting()) return 'Converting...';
    return convertsCheckboxes() ? `${selectedCheckboxCount()} tasks` : 'Task';
  };

  const handleConvertToTasks = () => {
    const lexicalSelection = editor.read($getSelection);
    if (!$isRangeSelection(lexicalSelection)) return;
    setIsConverting(true);
    editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
      selection: lexicalSelection,
      onComplete: (results) => {
        setIsConverting(false);
        const created = results.filter((result) => result.isOk()).length;
        if (created > 0) {
          toast.success(`Created ${created} task${created > 1 ? 's' : ''}`);
        }
        if (
          results.some(
            (result) => result.isErr() && result.error.tag !== 'EmptyCheckbox'
          )
        ) {
          toast.failure('Some checklist items could not become tasks');
        }
        setPopupVisible(false);
      },
    });
  };

  const shouldShowTableButton = () =>
    Boolean(canEdit() && convertibleListKey());

  const shouldShowEditWithAiButton = () =>
    inlineAiEditing().enabled && canEdit();

  /** Resolves to the point after the inserted mention, or null if it failed. */
  const insertTaskMention = async (
    point: SavedPoint,
    task: { documentId: string; title: string }
  ): Promise<SavedPoint | null> => {
    // Tracking only records the backlink; the mention still links without it.
    let mentionUuid: string | undefined;
    try {
      mentionUuid = await trackMention(blockId, 'document', task.documentId);
    } catch (error) {
      Telemetry.error(error, { surface: 'markdown-create-task' });
    }
    let next: SavedPoint | null = null;
    editor.update(
      () => {
        next = $insertAtSavedPoint(point, [
          $createTextNode(' '),
          $createDocumentMentionNode({
            documentId: task.documentId,
            documentName: task.title,
            blockName: 'task',
            createdAt: Date.now(),
            mentionUuid,
          }),
        ]);
      },
      { discrete: true }
    );
    if (next) return next;
    toast.failure('Could not link the task in this document');
    if (mentionUuid) {
      fireAndForget(
        untrackMention(blockId, mentionUuid, 'document'),
        'markdown-create-task'
      );
    }
    return null;
  };

  // Opens the task composer on the highlighted snippet, as a channel
  // message's "Create task" does, and can link the task after the snippet.
  const handleCreateTask = () => {
    if (convertsCheckboxes()) {
      handleConvertToTasks();
      return;
    }
    const snippet = editor.read(() => {
      const lexicalSelection = $getSelection();
      const location = $getSelectionLocation();
      if (!$isRangeSelection(lexicalSelection) || !location) return null;
      const { key, offset, type } = lexicalSelection.isBackward()
        ? lexicalSelection.anchor
        : lexicalSelection.focus;
      return {
        text: lexicalSelection.getTextContent(),
        location,
        end: { key, offset, type },
      };
    });
    const splitManager = globalSplitManager();
    if (!snippet || !splitManager) return;

    const text = snippet.text.replace(/\s+/g, ' ').trim();
    // Create More links each task after the previous one, in creation order.
    let linking = Promise.resolve<SavedPoint>(snippet.end);
    const linkTask = (task: ComposeTaskSuccess) => {
      const previous = linking;
      linking = (async () => {
        const point = await previous;
        return (await insertTaskMention(point, task)) ?? point;
      })();
      fireAndForget(linking, 'markdown-create-task');
    };
    splitManager.createPopoverSplit({
      content: {
        type: 'component',
        id: 'task-compose',
        params: {
          initialTitle: text.length > 70 ? `${text.slice(0, 70)}...` : text,
          initialContent: buildMentionMarkdownString({
            type: 'document',
            documentId: blockId,
            documentName: persistedName() ?? fallbackName() ?? '',
            blockName: 'md',
            blockParams: {
              [URL_PARAMS.location]: serializePersistentLocation(
                snippet.location
              ),
            },
          }),
          linkInSource: canEdit()
            ? {
                label: 'Link in document',
                insert: linkTask,
              }
            : undefined,
        },
      },
    });
    setPopupVisible(false);
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
    try {
      await navigator.clipboard.writeText(location);
    } catch (error) {
      Telemetry.error(error, { surface: 'markdown-editor' });
      toast.failure('Could not copy link');
      return;
    }
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
    const [threadId] = commentState.highlightedCommentThreads;
    if (threadId != null) {
      setCommentState('activeCommentThread', threadId);
    }
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
            {/* Selection actions: AI edit + create task. */}
            <Show when={shouldShowEditWithAiButton()}>
              <Toolbar.Button size="sm" onClick={() => setActivePrompt('ai')}>
                AI edit
              </Toolbar.Button>
            </Show>
            <Show when={shouldShowCreateTaskButton()}>
              <Toolbar.Button
                size="sm"
                tooltip={
                  convertsCheckboxes()
                    ? 'Create a task for each checklist item'
                    : 'Create task from snippet'
                }
                onClick={handleCreateTask}
                disabled={isConverting()}
              >
                <Dynamic
                  component={isConverting() ? LoadingIcon : CheckSquareIcon}
                  class="size-4"
                />
                {createTaskLabel()}
              </Toolbar.Button>
            </Show>
            <Show
              when={
                shouldShowEditWithAiButton() || shouldShowCreateTaskButton()
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
                aria-label="Comment"
                size="icon-sm"
                onClick={handleInsertComment}
                tooltip="Comment"
              >
                <ChatTeardrop class="size-4" />
              </Toolbar.Button>
            </Show>
            <Toolbar.Button
              aria-label="Copy link to snippet"
              size="icon-sm"
              onClick={() => fireAndForget(handleShare(), 'markdown-editor')}
              tooltip="Copy link to snippet"
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
              variant="secondary"
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
          class="z-action-menu"
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
            hasSelection={(selection()?.text ?? '') !== ''}
            showCreateTaskOption={shouldShowCreateTaskButton()}
            createTaskLabel={createTaskLabel()}
            isConverting={isConverting()}
            showTableOption={shouldShowTableButton()}
            showEditWithAiOption={shouldShowEditWithAiButton()}
            showOpenCommentOption={
              commentState.highlightedCommentThreads.length > 0
            }
            locationCopied={locationCopied()}
            setPopupVisible={setPopupVisible}
            onCreateTask={handleCreateTask}
            onConvertListToTable={handleConvertListToTable}
            onOpenComment={handleShowComment}
            onShare={() => fireAndForget(handleShare(), 'markdown-editor')}
            onInsertComment={handleInsertComment}
            onPaste={() => fireAndForget(handlePaste(), 'markdown-editor')}
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
        {/* Touch menus must escape the split's isolation to sit above mobile chrome. */}
        <ScopedPortal scope={isTouchDevice() ? 'global' : 'local'}>
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
            <MobileDrawer.Overlay />
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
