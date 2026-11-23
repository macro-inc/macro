/**
 * @file Collapsible sections: any top-level heading folds away everything
 * under it, up to the next heading of the same or a higher level.
 *
 * Folding is view state, not document content. The plugin only toggles a
 * class on the hidden blocks' DOM after each reconciliation (like the task
 * list's dimming), so the document, its Markdown, collaboration, copy, and
 * export are untouched. Which headings are folded is kept per person and per
 * device, keyed by the headings' durable node ids.
 *
 * A caret, a link, a search match, or an outline jump that lands inside a
 * folded section unfolds it, so nobody types into or is sent to text they
 * cannot see.
 */
import { makePersistedState } from '@app/lib/persistence';
import { IS_MAC } from '@core/constant/isMac';
import { $isHeadingNode } from '@lexical/rich-text';
import { $dfs, mergeRegister } from '@lexical/utils';
import { $getId } from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  GO_TO_LOCATION_COMMAND,
  GO_TO_NODE_ID_COMMAND,
} from '../location/locationPlugin';
import { dispatchInternalLayoutShift } from '../shared/utils';
import {
  computeFoldPlan,
  enclosingHeadings,
  type FoldBlock,
  type FoldPlan,
} from './foldPlan';
import { readFoldedIds, writeFoldedIds } from './foldStorage';

/** Unfold whatever section hides this node, e.g. before scrolling to it. */
export const REVEAL_NODE_COMMAND = createCommand<NodeKey>(
  'REVEAL_NODE_COMMAND'
);

export const FOLDED_BLOCK_CLASS = 'md-folded';
export const FOLDED_HEADING_CLASS = 'md-heading-folded';
/** Marks headings that show a fold control, so the drag handle steps aside. */
export const FOLDABLE_HEADING_ATTRIBUTE = 'data-md-foldable';

/** A fold control's place, relative to the editor root's parent. */
export type HeadingFoldControl = {
  key: NodeKey;
  folded: boolean;
  top: number;
  lineHeight: number;
};

type FoldBlockWithId = FoldBlock & { id: string | null };

/**
 * The element to measure for something inside a document: itself, or, inside
 * a folded section, the heading that folds it (hidden elements measure as
 * zero, at the top of the page).
 */
export function visibleAnchor(element: HTMLElement): HTMLElement {
  let block = element.closest<HTMLElement>(`.${FOLDED_BLOCK_CLASS}`);
  if (!block) return element;
  while (block?.classList.contains(FOLDED_BLOCK_CLASS)) {
    const previous: Element | null = block.previousElementSibling;
    if (!(previous instanceof HTMLElement)) return element;
    block = previous;
  }
  return block ?? element;
}

function $readBlocks(): FoldBlockWithId[] {
  return $getRoot()
    .getChildren()
    .map((node) => ({
      key: node.getKey(),
      level: $isHeadingNode(node) ? Number(node.getTag().slice(1)) : null,
      id: $getId(node),
    }));
}

function $findNodeKeyById(id: string): NodeKey | null {
  for (const { node } of $dfs($getRoot())) {
    if ($getId(node) === id) return node.getKey();
  }
  return null;
}

/** First line's height, so the control centers on it in wrapped headings. */
function lineHeightOf(element: HTMLElement, fallback: number) {
  const value = parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(value) ? Math.min(value, fallback) : fallback;
}

export function createHeadingFolds(props: {
  documentId: string;
  /** Without a user, folds last until the document closes. */
  userId: string | undefined;
}) {
  const { documentId, userId } = props;
  const [foldedIds, setFoldedIds] = makePersistedState(
    createSignal<string[]>([]),
    {
      storages: {
        restore: () => (userId ? readFoldedIds(userId, documentId) : undefined),
        write: (ids) => {
          if (userId) writeFoldedIds(userId, documentId, ids);
        },
      },
    }
  );
  const [controls, setControls] = createStore<HeadingFoldControl[]>([]);
  const [hoveredKey, setHoveredKey] = createSignal<NodeKey | null>(null);

  let editor: LexicalEditor | undefined;
  let blocks: FoldBlockWithId[] = [];
  let plan: FoldPlan = { headings: [], hidden: [] };
  let hiddenKeys = new Set<NodeKey>();
  let measureFrame: number | undefined;
  /** Heading element → key, for the controls on screen. */
  let controlKeys = new Map<HTMLElement, NodeKey>();

  let idByKey = new Map<NodeKey, string | null>();
  let folded = new Set<string>();

  const idOf = (key: NodeKey) => idByKey.get(key) ?? null;

  const isFolded = (key: NodeKey) => {
    const id = idOf(key);
    return !!id && folded.has(id);
  };

  /** Write the current plan onto the DOM and re-place the controls. */
  const apply = () => {
    if (!editor) return;
    const ed = editor;
    blocks = ed.getEditorState().read($readBlocks);
    idByKey = new Map(blocks.map((b) => [b.key, b.id]));
    folded = new Set(foldedIds());
    plan = computeFoldPlan(blocks, isFolded);

    const nextHidden = new Set(plan.hidden);
    for (const key of hiddenKeys) {
      if (nextHidden.has(key)) continue;
      ed.getElementByKey(key)?.classList.remove(FOLDED_BLOCK_CLASS);
    }
    // Re-add on every pass: reconciliation can replace a block's element.
    for (const key of nextHidden) {
      ed.getElementByKey(key)?.classList.add(FOLDED_BLOCK_CLASS);
    }
    hiddenKeys = nextHidden;

    const foldable = new Set(plan.headings.map((h) => h.key));
    for (const block of blocks) {
      if (block.level === null) continue;
      const element = ed.getElementByKey(block.key);
      if (!element) continue;
      element.classList.toggle(
        FOLDED_HEADING_CLASS,
        foldable.has(block.key) && isFolded(block.key)
      );
      element.toggleAttribute(
        FOLDABLE_HEADING_ATTRIBUTE,
        foldable.has(block.key) && !!block.id
      );
    }

    scheduleMeasure();
  };

  const measure = () => {
    measureFrame = undefined;
    const root = editor?.getRootElement();
    const parent = root?.parentElement;
    if (!editor || !root || !parent) return;
    const parentTop = parent.getBoundingClientRect().top;

    const next: HeadingFoldControl[] = [];
    const keys = new Map<HTMLElement, NodeKey>();
    for (const heading of plan.headings) {
      if (heading.hidden || !idOf(heading.key)) continue;
      const element = editor.getElementByKey(heading.key);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      keys.set(element, heading.key);
      next.push({
        key: heading.key,
        folded: heading.folded,
        top: rect.top - parentTop,
        lineHeight: lineHeightOf(element, rect.height),
      });
    }
    controlKeys = keys;
    setControls(reconcile(next, { key: 'key' }));
  };

  const scheduleMeasure = () => {
    if (measureFrame !== undefined) return;
    measureFrame = requestAnimationFrame(measure);
  };

  const setFolded = (ids: string[]) => {
    // Keep only headings still in the document, so storage stays small.
    const present = new Set(blocks.map((b) => b.id));
    setFoldedIds(ids.filter((id) => present.has(id)));
    apply();
    // Folds change from command handlers and update listeners; touch the
    // editor again only once that update has finished.
    queueMicrotask(() => {
      if (!editor) return;
      moveSelectionOutOfFolds(editor);
      // Search, comment, and selection highlights re-measure on this.
      dispatchInternalLayoutShift(editor);
    });
  };

  /**
   * Folding a section that holds the caret puts the caret at the end of the
   * nearest visible block before it (the folded heading), so typing never
   * lands in hidden text.
   */
  const moveSelectionOutOfFolds = (ed: LexicalEditor) => {
    const $hiddenTopKey = (key: NodeKey) => {
      const top = $getNodeByKey(key)?.getTopLevelElement();
      return top && hiddenKeys.has(top.getKey()) ? top.getKey() : null;
    };
    const needsMove = ed.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      return (
        $hiddenTopKey(selection.anchor.key) !== null ||
        $hiddenTopKey(selection.focus.key) !== null
      );
    });
    if (!needsMove) return;

    ed.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const hiddenKey =
        $hiddenTopKey(selection.anchor.key) ??
        $hiddenTopKey(selection.focus.key);
      let target = hiddenKey ? $getNodeByKey(hiddenKey) : null;
      while (target && hiddenKeys.has(target.getKey())) {
        target = target.getPreviousSibling();
      }
      target?.selectEnd();
    });
  };

  const toggle = (key: NodeKey) => {
    const id = idOf(key);
    if (!id) return;
    const ids = foldedIds();
    setFolded(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  /** Unfold the sections around a node; true when something unfolded. */
  const reveal = (key: NodeKey) => {
    if (!editor || hiddenKeys.size === 0) return false;
    const topKey = editor
      .getEditorState()
      .read(() => $getNodeByKey(key)?.getTopLevelElement()?.getKey());
    if (!topKey || !hiddenKeys.has(topKey)) return false;
    const index = blocks.findIndex((b) => b.key === topKey);
    if (index === -1) return false;

    const unfold = new Set(
      enclosingHeadings(blocks, index).map((k) => idOf(k))
    );
    setFolded(foldedIds().filter((id) => !unfold.has(id)));
    return true;
  };

  const revealId = (id: string | undefined) => {
    if (!id || !editor || hiddenKeys.size === 0) return;
    const key = editor.getEditorState().read(() => $findNodeKeyById(id));
    if (key) reveal(key);
  };

  /** The foldable heading holding a collapsed caret, if any. */
  const $caretHeadingKey = () => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
    const top = selection.anchor.getNode().getTopLevelElement();
    if (!top || !$isHeadingNode(top)) return null;
    const key = top.getKey();
    return plan.headings.some((h) => h.key === key && !h.hidden) ? key : null;
  };

  const plugin = (ed: LexicalEditor) => {
    editor = ed;
    apply();

    const resizeObserver = new ResizeObserver(scheduleMeasure);

    const onPointerMove = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const heading = event.target.closest(`[${FOLDABLE_HEADING_ATTRIBUTE}]`);
      if (!(heading instanceof HTMLElement)) {
        setHoveredKey(null);
        return;
      }
      setHoveredKey(controlKeys.get(heading) ?? null);
    };
    const onPointerLeave = () => setHoveredKey(null);
    let observedRoot: HTMLElement | null = null;
    const observeRoot = (root: HTMLElement | null) => {
      observedRoot?.removeEventListener('pointermove', onPointerMove);
      observedRoot?.removeEventListener('pointerleave', onPointerLeave);
      resizeObserver.disconnect();
      observedRoot = root;
      if (!root) return;
      resizeObserver.observe(root);
      root.addEventListener('pointermove', onPointerMove);
      root.addEventListener('pointerleave', onPointerLeave);
    };

    return mergeRegister(
      ed.registerRootListener((root) => observeRoot(root)),
      () => {
        observeRoot(null);
        if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
        editor = undefined;
      },
      ed.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size > 0 || dirtyLeaves.size > 0) apply();

        // A caret moved into a folded section (Enter after a folded
        // heading, undo, a click below the document) unfolds it.
        const caretKey = ed.getEditorState().read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection) && selection.isCollapsed()
            ? selection.anchor.key
            : null;
        });
        if (caretKey) reveal(caretKey);
      }),
      ed.registerCommand(
        REVEAL_NODE_COMMAND,
        (key) => reveal(key),
        COMMAND_PRIORITY_NORMAL
      ),
      // Links to a node or a text range: unfold first, then let the
      // location plugin scroll to the now visible element.
      ed.registerCommand(
        GO_TO_NODE_ID_COMMAND,
        (id) => {
          revealId(id);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      ed.registerCommand(
        GO_TO_LOCATION_COMMAND,
        (location) => {
          revealId(location?.anchor.id);
          revealId(location?.focus.id);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      // Mod+Enter on a heading folds or unfolds it, as it toggles a checkbox
      // in a check list (whose handler is lower priority).
      ed.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.shiftKey) return false;
          if (!(IS_MAC ? event.metaKey : event.ctrlKey)) return false;
          const key = $caretHeadingKey();
          if (!key) return false;
          event.preventDefault();
          toggle(key);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  };

  return {
    controls,
    hoveredKey,
    /** Keeps a control shown while the pointer is on it, off the heading. */
    hover: setHoveredKey,
    toggle,
    plugin,
  };
}

export type HeadingFolds = ReturnType<typeof createHeadingFolds>;
