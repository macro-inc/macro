import { Telemetry } from '@macro-inc/observability';
import type { CommitInfo, EditorView } from './editor-view';

interface Mark {
  readonly elements: readonly HTMLElement[];
  readonly blocks: ReadonlySet<HTMLElement>;
}
/** Geometry follows dirty blocks and ResizeObserver layout shifts, never all marks per key. */
export class MarkGeometry<Id extends string> {
  private marks = new Map<Id, Mark>();
  private byBlock = new Map<HTMLElement, Set<Id>>();
  private orderedBlocks: HTMLElement[] = [];
  private blocks = new Map<number, HTMLElement>();
  private sizes = new WeakMap<Element, { width: number; height: number }>();
  private dirty = new Set<Id>();
  private frame: number | null = null;
  private context = Telemetry.captureContext();
  private readonly observer: ResizeObserver;
  private readonly detach: () => void;
  private readonly window: Window;
  constructor(
    private readonly view: EditorView,
    private readonly margin: HTMLElement,
    private readonly update: (id: Id, top: number) => void
  ) {
    const window = view.root.ownerDocument.defaultView;
    if (!window) throw new Error('Mark geometry requires an owning window');
    this.window = window;
    this.observer = new window.ResizeObserver((entries) => {
      for (const entry of entries) {
        const size = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        const previous = this.sizes.get(entry.target);
        this.sizes.set(entry.target, size);
        if (
          !previous ||
          (previous.width === size.width && previous.height === size.height)
        )
          continue;
        if (
          entry.target === margin ||
          (entry.target === view.root && previous.width !== size.width)
        )
          this.invalidateAll();
        else if (
          entry.target instanceof HTMLElement &&
          entry.target !== view.root
        )
          this.invalidateFrom(entry.target);
      }
      // ResizeObserver is before paint: keep cards aligned through scroll anchoring.
      this.flush();
    });
    this.observer.observe(margin);
    this.observer.observe(view.root);
    for (const key of view.node(0)?.children ?? []) this.observe(key);
    this.detach = view.onCommit((info) => this.commit(info));
  }
  setMarks(marks: ReadonlyMap<Id, readonly HTMLElement[]>): void {
    let changed = false;
    for (const [id, previous] of this.marks) {
      const elements = marks.get(id);
      if (
        elements &&
        elements.length === previous.elements.length &&
        elements.every((el, i) => el === previous.elements[i])
      )
        continue;
      for (const block of previous.blocks) {
        const ids = this.byBlock.get(block);
        ids?.delete(id);
        if (!ids?.size) this.byBlock.delete(block);
      }
      this.marks.delete(id);
      this.dirty.delete(id);
      changed = true;
    }
    for (const [id, elements] of marks) {
      if (this.marks.has(id)) continue;
      const blocks = new Set<HTMLElement>();
      for (const element of elements) {
        let block = element;
        while (block.parentElement && block.parentElement !== this.view.root)
          block = block.parentElement;
        if (block.parentElement !== this.view.root) continue;
        blocks.add(block);
        const ids = this.byBlock.get(block) ?? new Set<Id>();
        ids.add(id);
        this.byBlock.set(block, ids);
      }
      this.marks.set(id, { elements: [...elements], blocks });
      this.dirty.add(id);
      changed = true;
    }
    if (changed) this.orderBlocks();
    this.schedule();
  }
  private orderBlocks(): void {
    this.orderedBlocks = [...this.byBlock.keys()].sort((a, b) =>
      a === b
        ? 0
        : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1
    );
  }
  private observe(key: number): void {
    const element = this.view.getElementByKey(key);
    const previous = this.blocks.get(key);
    if (element === previous) return;
    if (previous) this.observer.unobserve(previous);
    if (element) {
      const previousSize = previous ? this.sizes.get(previous) : undefined;
      if (previousSize) this.sizes.set(element, previousSize);
      this.blocks.set(key, element);
      this.observer.observe(element);
    } else this.blocks.delete(key);
  }
  private invalidateAll(): void {
    for (const id of this.marks.keys()) this.dirty.add(id);
  }
  private invalidateFrom(block: HTMLElement): void {
    // Binary search the marked blocks: unmarked paragraphs never require a mark scan.
    let left = 0,
      right = this.orderedBlocks.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const current = this.orderedBlocks[middle];
      if (
        current !== block &&
        current.compareDocumentPosition(block) &
          Node.DOCUMENT_POSITION_FOLLOWING
      )
        left = middle + 1;
      else right = middle;
    }
    for (let i = left; i < this.orderedBlocks.length; i++) {
      for (const id of this.byBlock.get(this.orderedBlocks[i]) ?? [])
        this.dirty.add(id);
    }
  }
  private commit(info: CommitInfo): void {
    this.context = Telemetry.captureContext();
    if (info.fullReconcile) {
      for (const element of this.blocks.values())
        this.observer.unobserve(element);
      this.blocks.clear();
      for (const key of this.view.node(0)?.children ?? []) this.observe(key);
      this.invalidateAll();
    } else {
      const dirtyBlocks = new Set<number>();
      const movedMarks = new Set<Id>();
      for (const [key, mutation] of info.mutations) {
        let before = mutation.before;
        while (before && before.parent !== null && before.parent !== 0)
          before =
            info.mutations.get(before.parent)?.before ??
            this.view.node(before.parent) ??
            undefined;
        if (before?.parent === 0) {
          const block = this.blocks.get(before.key);
          if (block)
            for (const id of this.byBlock.get(block) ?? []) {
              this.dirty.add(id);
              if (mutation.before?.parent !== mutation.after?.parent)
                movedMarks.add(id);
            }
        }
        if (mutation.before?.parent === 0 || mutation.after?.parent === 0) {
          if (mutation.after?.parent === 0) {
            const previous = this.blocks.get(key);
            this.observe(key);
            if (previous && previous !== this.blocks.get(key)) {
              for (const id of this.byBlock.get(previous) ?? [])
                movedMarks.add(id);
            }
          } else {
            const element = this.blocks.get(key);
            if (element) this.observer.unobserve(element);
            this.blocks.delete(key);
          }
        }
        let node = mutation.after;
        while (node && node.parent !== null && node.parent !== 0)
          node = this.view.node(node.parent) ?? undefined;
        if (node?.parent === 0) dirtyBlocks.add(node.key);
      }
      let reordered = false;
      for (const id of movedMarks) {
        const mark = this.marks.get(id);
        if (!mark) continue;
        const blocks = new Set<HTMLElement>();
        for (const element of mark.elements) {
          let block = element;
          while (block.parentElement && block.parentElement !== this.view.root)
            block = block.parentElement;
          if (block.parentElement === this.view.root) blocks.add(block);
        }
        if (
          blocks.size === mark.blocks.size &&
          [...blocks].every((block) => mark.blocks.has(block))
        )
          continue;
        for (const block of mark.blocks) {
          const ids = this.byBlock.get(block);
          ids?.delete(id);
          if (!ids?.size) this.byBlock.delete(block);
        }
        for (const block of blocks) {
          const ids = this.byBlock.get(block) ?? new Set<Id>();
          ids.add(id);
          this.byBlock.set(block, ids);
        }
        this.marks.set(id, { elements: mark.elements, blocks });
        reordered = true;
      }
      if (reordered) this.orderBlocks();
      for (const key of dirtyBlocks) {
        const block = this.blocks.get(key);
        if (block)
          for (const id of this.byBlock.get(block) ?? []) this.dirty.add(id);
      }
      if (info.children.has(0)) {
        // Topology changes can move later anchors without changing their own size.
        this.orderBlocks();
        const before = info.mutations.get(0)?.before?.children ?? [];
        const after = this.view.node(0)?.children ?? [];
        let first = 0;
        while (first < before.length && before[first] === after[first]) first++;
        const block = this.view.getElementByKey(after[first]);
        if (block) this.invalidateFrom(block);
      }
    }
    this.schedule();
  }
  private schedule(): void {
    if (!this.dirty.size || this.frame !== null) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }
  private flush(): void {
    if (!this.dirty.size) return;
    this.context.run(() => {
      const span = Telemetry.span('view.comment_geometry', {
        sampling: 'perf',
      });
      span.setAttr('editor.namespace', this.view.options.namespace);
      try {
        const marginTop = this.margin.getBoundingClientRect().top;
        let measured = 0;
        for (const id of this.dirty) {
          const mark = this.marks.get(id);
          if (!mark) continue;
          let top = Infinity;
          for (const element of mark.elements) {
            if (!element.isConnected) continue;
            top = Math.min(top, element.getBoundingClientRect().top);
            measured++;
          }
          if (top !== Infinity) this.update(id, top - marginTop);
        }
        span.setAttr('marks.invalidated', this.dirty.size);
        span.setAttr('anchors.measured', measured);
        this.dirty.clear();
      } catch (error) {
        span.error(error instanceof Error ? error.name : 'UnknownError');
        throw error;
      } finally {
        span.end();
      }
    });
  }
  dispose(): void {
    this.detach();
    this.observer.disconnect();
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.dirty.clear();
  }
}
