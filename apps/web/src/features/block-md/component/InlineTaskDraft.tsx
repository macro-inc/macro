import { registerInlineTaskDraftPlugin } from '@core/component/LexicalMarkdown/plugins/inline-task-draft/inlineTaskDraftPlugin';
import { focusNeighborTask, isPlainArrow } from '@core/component/inlineTaskNavigation';
import { $createDocumentMentionNode } from '@macro-inc/lexical-core';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $isElementNode,
  $isParagraphNode,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';

type Draft = {
  key: NodeKey;
  title: string;
  pending: boolean;
  error?: string;
  /** Retain a successful create if insertion fails, so retry never duplicates it. */
  createdTask?: { id: string; title: string };
};

type Position = { top: string; left: string; width: string };
const DEFAULT_POSITION: Position = { top: '0px', left: '0px', width: '100%' };

/** Editor-local forms over ordinary empty paragraphs, never saved draft nodes. */
export function InlineTaskDraft(props: {
  editor: LexicalEditor;
  canEdit: () => boolean;
  isInlineMenuOpen: () => boolean;
  createTask: (title: string) => Promise<string | null>;
}) {
  const [drafts, setDrafts] = createSignal<Record<NodeKey, Draft>>({});
  const [draftKeys, setDraftKeys] = createSignal<NodeKey[]>([]);
  const [activeKey, setActiveKey] = createSignal<NodeKey>();
  const [positions, setPositions] = createSignal<Record<NodeKey, Position>>({});
  const inputs = new Map<NodeKey, HTMLInputElement>();
  let disposed = false;

  const startDraft = (key: NodeKey) => {
    const existing = drafts()[key];
    if (existing) {
      if (existing.pending || existing.createdTask) return;
      setActiveKey(key);
      // Re-entering the same draft does not retrigger the active-key focus effect.
      requestAnimationFrame(() => inputs.get(key)?.focus({ preventScroll: true }));
      return;
    }
    setDrafts((values) => ({
      ...values,
      [key]: { key, title: '', pending: false },
    }));
    setDraftKeys((keys) => [...keys, key]);
    setActiveKey(key);
  };

  const updateDraft = (key: NodeKey, patch: Partial<Draft>) => {
    setDrafts((values) => {
      const current = values[key];
      return current ? { ...values, [key]: { ...current, ...patch } } : values;
    });
  };

  const removeDraft = (key: NodeKey) => {
    setDraftKeys((keys) => keys.filter((value) => value !== key));
    setDrafts((values) => {
      const next = { ...values };
      delete next[key];
      return next;
    });
    if (activeKey() === key) setActiveKey(undefined);
  };

  const updatePositions = () => {
    const root = props.editor.getRootElement();
    const container = root?.parentElement;
    if (!root || !container) return;
    const rootRect = root.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const next: Record<NodeKey, Position> = {};
    for (const key of draftKeys()) {
      const element = props.editor.getElementByKey(key);
      const rect = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : undefined;
      const inset = style ? Number.parseFloat(style.paddingInlineStart) || 0 : 0;
      const rtl = style?.direction === 'rtl';
      next[key] = {
        // Missing anchors remain visible so failed submissions can be recovered.
        top: `${(rect?.top ?? rootRect.bottom) - containerRect.top + container.scrollTop}px`,
        left: `${(rect?.left ?? rootRect.left) + (rtl ? 0 : inset) - containerRect.left + container.scrollLeft}px`,
        width: `${(rect?.width ?? rootRect.width) - inset}px`,
      };
    }
    setPositions(next);
  };

  onCleanup(
    registerInlineTaskDraftPlugin(props.editor, {
      canEdit: props.canEdit,
      isInlineMenuOpen: props.isInlineMenuOpen,
      draftStatus: (key) => {
        const draft = drafts()[key];
        return draft ? draft.pending || draft.createdTask ? 'reserved' : 'editable' : undefined;
      },
      onDraft: startDraft,
    })
  );
  onCleanup(props.editor.registerUpdateListener(updatePositions));

  const resizeObserver = new ResizeObserver(updatePositions);
  onCleanup(
    props.editor.registerRootListener((root) => {
      resizeObserver.disconnect();
      if (root) resizeObserver.observe(root);
      updatePositions();
    })
  );
  window.addEventListener('resize', updatePositions);
  onCleanup(() => {
    disposed = true;
    resizeObserver.disconnect();
    window.removeEventListener('resize', updatePositions);
  });

  createEffect(
    on(activeKey, (key) => {
      if (!key) return;
      // Focus after Lexical commits, so its selection does not steal focus back.
      const frame = requestAnimationFrame(() => {
        if (disposed || activeKey() !== key) return;
        updatePositions();
        const input = inputs.get(key);
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: 'nearest' });
      });
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );

  const exitDraft = (key: NodeKey) => {
    const current = drafts()[key];
    if (!current || current.pending) return;
    removeDraft(key);
    props.editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isParagraphNode(node) && node.isAttached()) node.selectEnd();
    });
    props.editor.focus();
  };

  const backspaceDraft = (key: NodeKey, input: HTMLInputElement) => {
    const current = drafts()[key];
    if (!current || current.pending || current.createdTask || !props.canEdit() || !props.editor.isEditable()) return false;
    if (input.selectionStart !== input.selectionEnd) return false;
    if (input.value && input.selectionStart !== 0) return false;

    let handled = false;
    props.editor.update(() => {
      const paragraph = $getNodeByKey(key);
      if (!$isParagraphNode(paragraph) || !paragraph.isAttached() || paragraph.getChildrenSize() !== 0) return;
      if (input.value) {
        paragraph.append($createTextNode(input.value));
        paragraph.selectStart();
      } else {
        const previous = paragraph.getPreviousSibling();
        if (previous) {
          paragraph.selectPrevious();
          paragraph.remove();
        } else {
          paragraph.selectStart();
        }
      }
      handled = true;
    }, { discrete: true });
    if (handled) {
      removeDraft(key);
      props.editor.focus();
    }
    return handled;
  };

  const advanceDraft = (current: Draft) => {
    let nextKey: NodeKey | undefined;
    props.editor.update(
      () => {
        if (!props.canEdit() || !props.editor.isEditable()) return;
        const anchor = $getNodeByKey(current.key);
        if (
          !$isParagraphNode(anchor) ||
          !anchor.isAttached() ||
          anchor.getChildrenSize() !== 0
        ) {
          return;
        }
        const following = anchor.getNextSibling();
        const existing = $isParagraphNode(following) && following.getChildrenSize() === 0
          ? drafts()[following.getKey()]
          : undefined;
        const next = $isParagraphNode(following) && following.getChildrenSize() === 0 &&
          (!existing || (!existing.pending && !existing.createdTask))
          ? following
          : $createParagraphNode();
        if (next !== following) anchor.insertAfter(next);
        if (next !== following || !existing) {
          next.setIndent(anchor.getIndent());
          next.setDirection(anchor.getDirection());
        }
        const selection = next.selectStart();
        selection.setFormat(0);
        selection.setStyle('');
        nextKey = next.getKey();
      },
      { discrete: true }
    );
    if (!nextKey) return false;
    startDraft(nextKey);
    return true;
  };

  const indentDraft = (key: NodeKey, change: number) => {
    props.editor.update(() => {
      if (!props.canEdit() || !props.editor.isEditable()) return;
      const paragraph = $getNodeByKey(key);
      if (!$isParagraphNode(paragraph) || !paragraph.isAttached() ||
          paragraph.getChildrenSize() !== 0) return;
      const previous = paragraph.getPreviousSibling();
      const limit = $isElementNode(previous) ? previous.getIndent() + 1 : 1;
      const indent = paragraph.getIndent();
      const nextIndent = change > 0
        ? Math.max(indent, Math.min(limit, indent + change))
        : Math.max(0, indent + change);
      paragraph.setIndent(nextIndent);
    }, { discrete: true, tag: SKIP_DOM_SELECTION_TAG });
    requestAnimationFrame(updatePositions);
  };

  const insertTask = (current: Draft, task: { id: string; title: string }) => {
    let inserted = false;
    props.editor.update(
      () => {
        if (!props.canEdit() || !props.editor.isEditable()) return;
        const paragraph = $getNodeByKey(current.key);
        // Keep completion order from changing line order or overwriting edits.
        if (
          !$isParagraphNode(paragraph) ||
          !paragraph.isAttached() ||
          paragraph.getChildrenSize() !== 0
        ) {
          return;
        }
        paragraph.append(
          $createDocumentMentionNode({
            documentId: task.id,
            documentName: task.title,
            blockName: 'task',
            createdAt: Date.now(),
          }),
          $createTextNode(' ')
        );
        inserted = true;
      },
      { discrete: true, tag: SKIP_DOM_SELECTION_TAG }
    );
    return inserted;
  };

  const submit = async (key: NodeKey) => {
    const current = drafts()[key];
    if (
      !current ||
      current.pending ||
      !props.canEdit() ||
      !props.editor.isEditable()
    ) {
      return;
    }
    const title = current.title.trim();
    if (!title && !current.createdTask) {
      exitDraft(key);
      return;
    }
    updateDraft(key, { title, pending: true, error: undefined });
    // Advance before starting the request. Retries use their original line.
    if (activeKey() === key && !advanceDraft(current)) {
      updateDraft(key, {
        pending: false,
        error: 'Restore this empty draft line, then press Enter to retry.',
      });
      return;
    }
    // Let the next input focus and paint before task creation does any work.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (disposed) return;
    try {
      let task = current.createdTask;
      if (!task) {
        const id = await props.createTask(title);
        if (!id) throw new Error('Task creation failed. Press Enter to retry.');
        task = { id, title };
        if (disposed) return;
        updateDraft(key, { createdTask: task });
      }
      if (disposed) return;
      if (insertTask(current, task)) {
        removeDraft(key);
      } else {
        updateDraft(key, {
          pending: false,
          error: 'Task created. Restore edit access and its empty line, then press Enter to insert it.',
        });
      }
    } catch (error) {
      if (disposed) return;
      const latest = drafts()[key];
      if (!latest) return;
      updateDraft(key, {
        pending: false,
        error: latest.createdTask
          ? 'Task created. Press Enter to retry inserting it.'
          : error instanceof Error
            ? error.message
            : 'Task creation failed. Press Enter to retry.',
      });
    }
  };

  return (
    <For each={draftKeys()}>
      {(key) => {
        onCleanup(() => inputs.delete(key));
        return (
          <Show when={drafts()[key]}>
            {(current) => (
              <form
                data-inline-task-draft={key}
                data-lexical-interactive
                aria-label="Task draft"
                aria-busy={current().pending}
                class="absolute z-10 flex items-center bg-transparent text-base leading-6"
                style={positions()[key] ?? DEFAULT_POSITION}
                on:click={(event) => event.stopPropagation()}
                on:mousedown={(event) => event.stopPropagation()}
                on:keydown={(event) => {
                  event.stopPropagation();
                  if (event.isComposing) return;
                  if (isPlainArrow(event)) {
                    const direction = event.key === 'ArrowUp' ? 'previous' : event.key === 'ArrowDown' ? 'next' : undefined;
                    if (direction && focusNeighborTask(props.editor, key, direction)) {
                      event.preventDefault();
                      return;
                    }
                  }
                  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey &&
                      !current().pending && !current().createdTask && props.canEdit() && props.editor.isEditable()) {
                    event.preventDefault();
                    indentDraft(key, event.shiftKey ? -1 : 1);
                    return;
                  }
                  if (event.key === 'Backspace' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.target instanceof HTMLInputElement && backspaceDraft(key, event.target)) {
                    event.preventDefault();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    exitDraft(key);
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (
                      !event.shiftKey &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey
                    ) {
                      void submit(key);
                    }
                  }
                }}
                on:submit={(event) => {
                  event.preventDefault();
                  void submit(key);
                }}
              >
                <span class="ml-[0.25em] mr-[0.5em] inline-flex size-[1.125em] shrink-0 opacity-40" aria-hidden="true">
                  <PropertyValueIcon
                    optionId={PROPERTY_OPTION_IDS.STATUS.NOT_STARTED}
                    class="size-full"
                  />
                </span>
                <input
                  ref={(element) => inputs.set(key, element)}
                  aria-label="Task name"
                  aria-description="Enter creates and continues. Empty Enter or Escape returns to normal text."
                  autocomplete="off"
                  placeholder="Task name…"
                  value={current().title}
                  readOnly={current().pending || !!current().createdTask}
                  disabled={!props.canEdit()}
                  class="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-placeholder"
                  on:focus={() => setActiveKey(key)}
                  on:input={(event) => {
                    updateDraft(key, { title: event.currentTarget.value, error: undefined });
                  }}
                />
                <Show when={current().error}>
                  {(error) => (
                    <span role="alert" class="absolute left-0 top-full mt-1 rounded-xs bg-input px-2 py-1 text-xs text-failure-ink">
                      {error()}
                    </span>
                  )}
                </Show>
              </form>
            )}
          </Show>
        );
      }}
    </For>
  );
}
