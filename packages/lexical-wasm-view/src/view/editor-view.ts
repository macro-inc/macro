/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalReconciler.ts keyed children, terminating BR,
 * LexicalMutations.ts observation and LexicalUpdates.ts listener ordering.
 * Pin: Lexical 0.45.0 / 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */

import {
  CommandCode,
  EditorInputMsg,
  type IViewEffectMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { type Span, Telemetry } from '@macro-inc/observability';
import { batch, createComponent, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ClipboardAccess } from './clipboard';
import type {
  KeyRoute,
  ViewCommand,
  ViewCommandPriority,
  ViewListener,
} from './commands';
import { textLeaf } from './dom';
import { registerEvents } from './events';
import { Mirror } from './mirror';
import type { EditorPort, TextFromView, ViewSink } from './port';
import { PresenceLayer } from './presence';
import { BulkQueries } from './queries';
import type {
  EditorThemeClasses,
  ElementDOMSlot,
  NodeViewRegistry,
  RenderContext,
} from './registry';
import { readSelection, sameSelection, writeSelection } from './selection';
import { selectionMessage } from './session-port';
import { TableObserver } from './table/observer';
import type {
  AppliedDiff,
  JsonValue,
  MutationKind,
  NodeKey,
  TypeFlags,
  ViewNode,
  ViewSelection,
  ViewSelectionInfo,
} from './types';

const roots = new WeakMap<Node, EditorView>();
export interface CommitInfo {
  readonly tags: readonly string[];
  readonly keys: readonly NodeKey[];
  readonly fullReconcile: boolean;
  readonly selectionChanged: boolean;
}
export interface ViewOptions {
  readonly namespace: string;
  readonly theme: EditorThemeClasses;
  readonly editable: boolean;
  readonly preset: 'rich' | 'plain';
  readonly onError: (error: unknown) => void;
  /** Caller-owned loading span; never ended by the view. */
  readonly parentSpan?: Span;
}
export class EditorView implements ViewSink {
  readonly mirror: Mirror;
  readonly query: BulkQueries;
  readonly clipboard: ClipboardAccess;
  readonly context: RenderContext;
  private readonly pluginEvents = new Map<
    string,
    Set<(payload: JsonValue) => void>
  >();
  private readonly keyRoutes = new Set<
    (event: KeyboardEvent) => KeyRoute | null
  >();
  private readonly viewCommands = new Map<string, ViewListener[]>();
  private readonly rustListeners: ReadonlyMap<string, number>;
  private readonly dom = new Map<NodeKey, HTMLElement>();
  private readonly tables = new Map<NodeKey, TableObserver>();
  private readonly keys = new WeakMap<Node, NodeKey>();
  private readonly decorators = new Map<
    NodeKey,
    { dispose: () => void; update: (node: ViewNode) => void; host: HTMLElement }
  >();
  private readonly commits = new Set<(info: CommitInfo) => void>();
  private readonly mutations = new Map<
    string,
    Set<(mutations: ReadonlyMap<NodeKey, MutationKind>) => void>
  >();
  private readonly histories = new Set<
    (state: { canUndo: boolean; canRedo: boolean }) => void
  >();
  private readonly decoratorListeners = new Set<
    (keys: readonly NodeKey[]) => void
  >();
  private readonly observer: MutationObserver;
  private readonly presence: PresenceLayer;
  private readonly events: ReturnType<typeof registerEvents>;
  private selectionMarkedAt = -Infinity;
  private selectionMark: ViewSelectionInfo | null = null;
  private selectionInfo: ViewSelectionInfo = {
    selection: { kind: 'none' },
    format: 0,
    style: '',
  };
  private disposed = false;
  private recovering = false;
  private prevented = false;
  private lastOps = 0;
  private paintFrame: number | null = null;
  private revisionValue = 0;
  private documentRevisionValue = 0;
  /** Content revision for drags; selection-only commits keep the source valid. */
  get documentRevision(): number {
    return this.documentRevisionValue;
  }
  get revision(): number {
    return this.revisionValue;
  }
  get isMounted(): boolean {
    return !this.disposed && roots.get(this.root) === this;
  }
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private constructor(
    readonly root: HTMLElement,
    readonly port: EditorPort,
    readonly registry: NodeViewRegistry,
    readonly options: ViewOptions,
    private openingSpan: Span | undefined
  ) {
    this.mirror = new Mirror(port.types());
    this.query = new BulkQueries(this, port);
    this.clipboard = new ClipboardAccess(this, port);
    this.rustListeners = port.listeners();
    this.context = {
      document: root.ownerDocument,
      namespace: options.namespace,
      theme: options.theme,
      view: this,
    };
    this.observer = new MutationObserver((records) => {
      const seen = new Set<NodeKey>();
      const repair = new Set<NodeKey>();
      for (const record of records) {
        const owner = EditorView.fromDOM(record.target);
        if (owner && owner !== this) continue;
        if (record.type === 'childList') {
          const key = this.keyFromDOM(record.target);
          if (key !== null && this.node(key)?.kind !== 'decorator')
            repair.add(key);
          continue;
        }
        if (record.type !== 'characterData') continue;
        const key = this.keyFromDOM(record.target);
        if (key === null || seen.has(key)) continue;
        seen.add(key);
        const node = this.node(key);
        if (node?.kind === 'text' && record.target.nodeValue !== node.text)
          this.submitText(key);
      }
      if (repair.size) {
        this.observer.disconnect();
        try {
          for (const key of repair) {
            const node = this.node(key),
              dom = this.getElementByKey(key);
            if (!node || !dom) continue;
            if (node.kind === 'text') {
              if (!textLeaf(dom)) this.replace(node, node, dom);
            } else this.reconcileChildren(key);
          }
          const active = this.root.ownerDocument.activeElement;
          if (active && this.ownsSelection(active))
            writeSelection(this, this.selectionInfo.selection);
        } finally {
          this.observe();
        }
      }
    });
    roots.set(root, this);
    root.setAttribute('data-lexical-editor', 'true');
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    this.setEditable(options.editable);
    this.observe();
    this.events = registerEvents(this);
    this.presence = new PresenceLayer(this);
  }
  static mount(
    root: HTMLElement,
    port: EditorPort,
    registry: NodeViewRegistry,
    options: ViewOptions
  ): EditorView {
    if (roots.has(root)) throw new Error('Editor root is already mounted');
    const span =
      options.parentSpan?.span('view.mount') ?? Telemetry.span('editor.open');
    try {
      return span.run(
        () => new EditorView(root, port, registry, options, span)
      );
    } catch (error) {
      span.error('view mount failed');
      span.end();
      throw error;
    }
  }
  ownsSelection(node: Node): boolean {
    return EditorView.fromDOM(node) === this;
  }
  static fromDOM(node: Node): EditorView | null {
    for (
      let current: Node | null = node;
      current;
      current = current.parentNode
    ) {
      const view = roots.get(current);
      if (view) return view;
    }
    return null;
  }
  private observe(): void {
    if (!this.disposed)
      this.observer.observe(this.root, {
        subtree: true,
        characterData: true,
        childList: true,
      });
  }
  ownsEvent(target: EventTarget | null, allowDecorator: boolean): boolean {
    const NodeType = this.root.ownerDocument.defaultView?.Node;
    if (!NodeType || !(target instanceof NodeType)) return false;
    for (let node: Node | null = target; node; node = node.parentNode) {
      if (node === this.root) return true;
      if (roots.has(node)) return false;
      const key = this.keys.get(node);
      if (
        !allowDecorator &&
        key !== undefined &&
        this.node(key)?.kind === 'decorator'
      )
        return false;
    }
    return false;
  }
  node(key: NodeKey): ViewNode | null {
    return this.mirror.node(key);
  }
  flags(node: ViewNode): TypeFlags | undefined {
    return (
      this.mirror.type(node.typeIndex).flags ??
      this.registry.get(node.type).flags?.(node)
    );
  }
  text(key: NodeKey): string | null {
    return this.node(key)?.text ?? null;
  }
  getElementByKey(key: NodeKey): HTMLElement | null {
    return this.dom.get(key) ?? null;
  }
  keyFromDOM(dom: Node): NodeKey | null {
    for (
      let current: Node | null = dom;
      current;
      current = current.parentNode
    ) {
      const key = this.keys.get(current);
      if (key !== undefined) return key;
      if (current === this.root) break;
    }
    return null;
  }
  slot(key: NodeKey): ElementDOMSlot | null {
    const node = this.node(key),
      dom = this.dom.get(key);
    if (!node || !dom) return null;
    return (
      this.registry.get(node.type).getDOMSlot?.(node, dom) ?? { element: dom }
    );
  }
  recentSelectionMark(): ViewSelectionInfo | null {
    return performance.now() < this.selectionMarkedAt + 200
      ? this.selectionMark
      : null;
  }
  selection(): ViewSelectionInfo {
    return this.selectionInfo;
  }
  get lastDiffOps(): number {
    return this.lastOps;
  }
  consumePreventDefault(): boolean {
    const value = this.prevented;
    this.prevented = false;
    return value;
  }
  acknowledgeSelection(selection: ViewSelection): void {
    this.selectionInfo = { ...this.selectionInfo, selection };
  }
  acknowledgeText(input: TextFromView): void {
    const diff = this.mirror.acknowledgeText(input.key, input.text);
    if ((input.selectionKind ?? 'range') === 'range')
      this.selectionInfo = {
        ...this.selectionInfo,
        selection: {
          kind: 'range',
          anchor: { key: input.key, offset: input.anchorOffset, type: 'text' },
          focus: { key: input.key, offset: input.focusOffset, type: 'text' },
        },
      };
    this.lastOps = 0;
    // The DOM originated this edit. Only mirror observers run; no renderer,
    // selection API, layout read or mutation-observer reconnection occurs.
    this.notify(diff, false);
  }
  apply(
    words: Uint32Array,
    strings: Uint8Array,
    effects: IViewEffectMsg[] = []
  ): void {
    if (this.disposed) throw new Error('Diff applied to a disposed view');
    for (const effect of effects) {
      if (effect.kind === 2)
        this.options.onError(new Error(effect.text || 'Editor session failed'));
    }
    const initialize = effects.some((effect) => effect.kind === 8);
    const paste = effects.some(
      (effect) => effect.kind === 11 && effect.keys.includes('paste')
    );
    if (!initialize && !paste) {
      this.applyOutput(words, strings, effects);
      return;
    }
    const load = initialize
      ? (this.openingSpan?.span('state.load') ?? Telemetry.span('state.load'))
      : undefined;
    const phase = load?.span('view.reconcile') ?? Telemetry.span('view.apply');
    try {
      phase.run(() => this.applyOutput(words, strings, effects));
      phase.setAttr('nodes', this.dom.size);
      phase.setAttr('decorators', this.decorators.size);
    } finally {
      phase.end();
      load?.end();
    }
    const window = this.root.ownerDocument.defaultView;
    if (initialize && window && this.openingSpan && this.paintFrame === null) {
      this.paintFrame = window.requestAnimationFrame(() => {
        this.paintFrame = window.requestAnimationFrame(() => {
          this.paintFrame = null;
          this.openingSpan?.end();
          this.openingSpan = undefined;
        });
      });
    }
  }
  private applyOutput(
    words: Uint32Array,
    strings: Uint8Array,
    effects: IViewEffectMsg[]
  ): void {
    this.observer.disconnect();
    try {
      this.presence.update(effects);
      if (effects.some((effect) => effect.kind === 9))
        this.events.endComposition();
      const initialize = effects.some((effect) => effect.kind === 8);
      if (initialize) {
        for (const table of this.tables.values()) table.dispose();
        this.tables.clear();
        for (const decorator of this.decorators.values()) decorator.dispose();
        this.decorators.clear();
        this.dom.clear();
        this.root.replaceChildren();
      }
      const diff = initialize
        ? this.mirror.initialize(words, strings)
        : this.mirror.apply(words, strings);
      this.lastOps = diff.opCount;
      for (const [key, mutation] of diff.mutations) {
        if (mutation.kind !== 'destroyed') continue;
        this.tables.get(key)?.dispose();
        this.tables.delete(key);
        this.decorators.get(key)?.dispose();
        this.decorators.delete(key);
        this.dom.get(key)?.remove();
        this.dom.delete(key);
      }
      for (const [key, mutation] of diff.mutations) {
        const node = mutation.after;
        if (!node) continue;
        if (mutation.kind === 'created') this.create(node);
        else if (diff.properties.has(key) && mutation.before) {
          const dom = this.dom.get(key);
          if (!dom) throw new Error('Missing DOM for updated key: ' + key);
          if (
            this.registry
              .get(node.type)
              .updateDOM(mutation.before, node, dom, this.context)
          )
            this.replace(mutation.before, node, dom);
        }
      }
      for (const key of diff.children) this.reconcileChildren(key);
      const dirtyTables = new Set<number>();
      for (const key of new Set([...diff.children, ...diff.properties])) {
        if (this.node(key)?.kind === 'text') continue;
        for (
          let node = this.node(key);
          node;
          node = node.parent === null ? null : this.node(node.parent)
        ) {
          if (node.type === 'table') {
            dirtyTables.add(node.key);
            break;
          }
        }
      }
      for (const key of dirtyTables) {
        const dom = this.dom.get(key);
        if (!(dom instanceof HTMLTableElement))
          throw new Error('Table view must mount a table');
        const observer = this.tables.get(key);
        if (observer) observer.refresh();
        else this.tables.set(key, new TableObserver(this, key, dom));
      }
      let selectionChanged = false;
      batch(() => {
        for (const effect of effects) {
          if (effect.kind !== 6) continue;
          switch (effect.code) {
            case 0: {
              const previousSelection = this.selectionInfo.selection;
              const next = effect.selection;
              const point = (p: typeof next.anchor) =>
                ({
                  key: p.key,
                  offset: p.offset,
                  type: p.type === 0 ? 'text' : 'element',
                }) as const;
              const selection =
                next.kind === 1
                  ? ({ kind: 'none' } as const)
                  : next.kind === 2
                    ? ({
                        kind: 'range',
                        anchor: point(next.anchor),
                        focus: point(next.focus),
                      } as const)
                    : next.kind === 3
                      ? ({ kind: 'node', keys: next.nodes } as const)
                      : next.kind === 4
                        ? ({
                            kind: 'table',
                            table: next.table,
                            anchorCell: next.anchor.key,
                            focusCell: next.focus.key,
                          } as const)
                        : ({ kind: 'keep' } as const);
              selectionChanged = !sameSelection(
                this.selectionInfo.selection,
                selection
              );
              this.selectionInfo = {
                selection,
                format: effect.format,
                style: effect.style,
              };
              if (
                selection.kind === 'range' &&
                selection.anchor.key === selection.focus.key &&
                selection.anchor.offset === selection.focus.offset
              ) {
                this.selectionMarkedAt = performance.now();
                this.selectionMark = this.selectionInfo;
              }
              if (selection.kind === 'table')
                this.tables
                  .get(selection.table)
                  ?.select(selection.anchorCell, selection.focusCell);
              else if (previousSelection.kind === 'table')
                this.tables.get(previousSelection.table)?.clear();
              writeSelection(this, selection);
              break;
            }
            case 1:
              for (const listener of this.histories)
                listener({
                  canUndo: effect.flag,
                  canRedo: effect.detail !== 0,
                });
              break;
            case 2:
              this.prevented = true;
              break;
            case 4:
              this.scrollIntoView(effect.detail);
              break;
            case 9: {
              const payload: JsonValue = effect.style
                ? JSON.parse(effect.style)
                : null;
              for (const listener of this.pluginEvents.get(effect.text) ?? [])
                listener(payload);
              break;
            }
            case 7:
              this.scheduleRemoveEmptyText(effect.detail, effect.format);
              break;
          }
        }
        for (const [key, mutation] of diff.mutations)
          if (mutation.after) this.updateDecorator(key, mutation.after);
      });
      this.notify(
        diff,
        selectionChanged,
        effects
          .filter((effect) => effect.kind === 11)
          .flatMap((effect) => effect.keys)
      );
      this.recovering = false;
    } catch (error) {
      this.options.onError(error);
      if (this.recovering) throw error;
      this.recovering = true;
      const span = Telemetry.span('editor.view_recover');
      try {
        span.setAttr('reason', error instanceof Error ? error.name : 'unknown');
        span.run(() => this.port.initialize());
      } finally {
        span.end();
      }
    } finally {
      this.observe();
    }
  }
  private create(node: ViewNode): void {
    const renderer = this.registry.get(node.type);
    const dom =
      node.kind === 'root' ? this.root : renderer.createDOM(node, this.context);
    this.dom.set(node.key, dom);
    this.keys.set(dom, node.key);
    dom.setAttribute('data-lexical-key', String(node.key));
    Reflect.set(dom, `__lexicalKey_${this.options.namespace}`, node.key);
    if (node.parent === 0 && node.kind === 'element') {
      dom.style.contentVisibility = 'auto';
      dom.style.containIntrinsicBlockSize = 'auto 24px';
    }
    if (node.kind === 'decorator') {
      dom.contentEditable = 'false';
      dom.setAttribute('data-lexical-decorator', 'true');
    }
  }
  private replace(
    before: ViewNode,
    node: ViewNode,
    previous: HTMLElement
  ): void {
    const oldSlot = this.registry
      .get(node.type)
      .getDOMSlot?.(before, previous) ?? { element: previous };
    this.create(node);
    const next = this.dom.get(node.key);
    if (!next) throw new Error('Replacement DOM was not created');
    const slot = this.slot(node.key);
    if (slot && (node.kind === 'element' || node.kind === 'root')) {
      for (const key of node.children) {
        const child = this.dom.get(key);
        if (child?.parentNode === oldSlot.element)
          slot.element.insertBefore(child, slot.before ?? null);
      }
    }
    const decorator = this.decorators.get(node.key);
    if (decorator) next.appendChild(decorator.host);
    previous.replaceWith(next);
  }
  private reconcileChildren(key: NodeKey): void {
    const node = this.node(key),
      slot = this.slot(key);
    if (!node || !slot) throw new Error('Missing child DOM slot');
    let current = slot.after ? slot.after.nextSibling : slot.element.firstChild;
    for (const key of node.children) {
      const child = this.dom.get(key);
      if (!child) throw new Error('Missing child DOM: ' + key);
      if (child === current) current = current.nextSibling;
      else slot.element.insertBefore(child, current ?? slot.before ?? null);
      const childNode = this.node(key);
      if (node.kind === 'root' && childNode?.kind === 'element') {
        child.style.contentVisibility = 'auto';
        child.style.containIntrinsicBlockSize = 'auto 24px';
      }
    }
    while (current && current !== slot.before) {
      const next = current.nextSibling;
      current.remove();
      current = next;
    }
    const last = this.node(node.children[node.children.length - 1]);
    const needsBreak =
      node.kind !== 'root' &&
      node.type !== 'table' &&
      node.type !== 'tablerow' &&
      (!last || last.kind === 'linebreak');
    const existing = slot.element.querySelector(
      ':scope > br[data-lexical-managed-linebreak]'
    );
    if (needsBreak && !existing) {
      const br = this.root.ownerDocument.createElement('br');
      br.setAttribute('data-lexical-managed-linebreak', 'true');
      slot.element.insertBefore(br, slot.before ?? null);
    } else if (!needsBreak) existing?.remove();
  }
  private updateDecorator(key: NodeKey, node: ViewNode): void {
    const component = this.registry.get(node.type).decorator;
    if (!component) return;
    const existing = this.decorators.get(key);
    if (existing) {
      existing.update(node);
      return;
    }
    const dom = this.dom.get(key);
    if (!dom) throw new Error('Decorator mount DOM missing');
    const [value, set] = createSignal(node);
    const host = this.root.ownerDocument.createElement('span');
    host.style.display = 'contents';
    dom.appendChild(host);
    const dispose = render(
      () => createComponent(component, { node: value, view: this }),
      host
    );
    this.decorators.set(key, {
      dispose,
      host,
      update: (next) => set(() => next),
    });
  }
  private notify(
    diff: AppliedDiff,
    selectionChanged: boolean,
    tags: readonly string[] = []
  ): void {
    if (diff.mutations.size || diff.fullReconcile) this.documentRevisionValue++;
    if (diff.mutations.size || selectionChanged || diff.fullReconcile)
      this.revisionValue++;
    for (const [type, listeners] of this.mutations) {
      const records = new Map<NodeKey, MutationKind>();
      for (const [key, change] of diff.mutations)
        if ((change.after ?? change.before)?.type === type)
          records.set(key, change.kind);
      if (records.size) for (const listener of listeners) listener(records);
    }
    const info = {
      tags,
      keys: [...diff.mutations.keys()],
      fullReconcile: diff.fullReconcile,
      selectionChanged,
    };
    for (const listener of this.commits) listener(info);
    const keys = [...diff.mutations]
      .filter(
        ([, change]) => (change.after ?? change.before)?.kind === 'decorator'
      )
      .map(([key]) => key);
    if (keys.length)
      for (const listener of this.decoratorListeners) listener(keys);
  }
  submitText(
    key: NodeKey,
    compositionEnd = false,
    compositionData?: string
  ): void {
    const node = this.node(key),
      dom = textLeaf(this.dom.get(key));
    if (node?.kind !== 'text' || dom?.nodeType !== 3) return;
    const selection = readSelection(this);
    this.port.textFromView({
      key,
      text: dom.nodeValue ?? '',
      anchorOffset: selection.kind === 'range' ? selection.anchor.offset : 0,
      focusOffset: selection.kind === 'range' ? selection.focus.offset : 0,
      selectionKind: selection.kind === 'range' ? 'range' : 'keep',
      compositionEnd,
      compositionData,
    });
  }
  private scheduleRemoveEmptyText(key: NodeKey, delay: number): void {
    const expected = this.node(key);
    if (expected?.kind !== 'text') return;
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      if (
        this.disposed ||
        this.node(key) !== expected ||
        !this.root.isContentEditable
      )
        return;
      const current = readSelection(this);
      if (
        current.kind !== 'range' ||
        current.anchor.key !== key ||
        current.focus.key !== key
      )
        return;
      const point = { key: 0, offset: 0, type: 0 };
      const target = {
        kind: 0,
        anchor: point,
        focus: point,
        dirty: false,
        backward: false,
      };
      this.port.input(
        EditorInputMsg.fromEditorCommand({
          command: CommandCode.RemoveText,
          a: 0,
          b: 0,
          text: '',
          selection: selectionMessage({
            kind: 'range',
            anchor: { key, offset: 0, type: 'text' },
            focus: { key, offset: expected.text.length, type: 'text' },
          }),
          target,
          characterTarget: target,
        })
      );
    }, delay);
    this.cleanupTimers.add(timer);
  }
  private scrollIntoView(key: NodeKey): void {
    const dom = this.dom.get(key);
    if (!dom) return;
    const bounds = dom.getBoundingClientRect(),
      root = this.root.getBoundingClientRect();
    if (bounds.top < root.top || bounds.bottom > root.bottom)
      dom.scrollIntoView({ block: 'nearest' });
  }
  dispatch(
    code: number,
    payload: { a?: number; b?: number; text?: string } = {}
  ): boolean | undefined {
    return this.port.command(code, payload.a, payload.b, payload.text);
  }
  /** Translate special keys into one admission, retaining model KeyDown precedence. */
  registerKeyRoute(
    resolve: (event: KeyboardEvent) => KeyRoute | null
  ): () => void {
    this.keyRoutes.add(resolve);
    return () => this.keyRoutes.delete(resolve);
  }
  keyRoute(event: KeyboardEvent): KeyRoute | null {
    for (const resolve of this.keyRoutes) {
      const route = resolve(event);
      if (route) return route;
    }
    return null;
  }
  registerViewCommand<P>(
    command: ViewCommand<P>,
    listener: (payload: P, view: EditorView) => boolean,
    priority: ViewCommandPriority
  ): () => void {
    if ((this.rustListeners.get(command.name) ?? 0) & (1 << priority))
      throw new Error(
        'View command priority ties a Rust listener: ' + command.name
      );
    const entry: ViewListener = {
      priority,
      invoke: (payload) => {
        if (!command.accepts(payload))
          throw new Error('Invalid view command payload: ' + command.name);
        return listener(payload, this);
      },
    };
    const entries = this.viewCommands.get(command.name) ?? [];
    entries.push(entry);
    entries.sort((left, right) => right.priority - left.priority);
    this.viewCommands.set(command.name, entries);
    return () => {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
    };
  }
  runViewCommand(
    name: string,
    payload: unknown,
    phase: 'before' | 'after'
  ): boolean {
    const levels = this.rustListeners.get(name) ?? 0;
    const highest = levels ? Math.floor(Math.log2(levels)) : -1;
    for (const entry of this.viewCommands.get(name) ?? []) {
      if (
        (phase === 'before'
          ? entry.priority > highest
          : entry.priority < highest) &&
        entry.invoke(payload)
      )
        return true;
    }
    return false;
  }
  onCommit(listener: (info: CommitInfo) => void): () => void {
    this.commits.add(listener);
    return () => this.commits.delete(listener);
  }
  onMutations(
    type: string,
    listener: (mutations: ReadonlyMap<NodeKey, MutationKind>) => void
  ): () => void {
    let listeners = this.mutations.get(type);
    if (!listeners) {
      listeners = new Set();
      this.mutations.set(type, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  /** Host requests are delivered after the native transition and its Diff. */
  onPluginEvent(
    name: string,
    listener: (payload: JsonValue) => void
  ): () => void {
    let listeners = this.pluginEvents.get(name);
    if (!listeners) {
      listeners = new Set();
      this.pluginEvents.set(name, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  onHistory(
    listener: (state: { canUndo: boolean; canRedo: boolean }) => void
  ): () => void {
    this.histories.add(listener);
    return () => this.histories.delete(listener);
  }
  onDecorators(listener: (keys: readonly NodeKey[]) => void): () => void {
    this.decoratorListeners.add(listener);
    return () => this.decoratorListeners.delete(listener);
  }
  focus(): void {
    this.root.focus();
  }
  blur(): void {
    this.root.blur();
  }
  setEditable(editable: boolean): void {
    this.root.contentEditable = String(editable);
  }
  dispose(): void {
    this.disposed = true;
    this.keyRoutes.clear();
    this.pluginEvents.clear();
    this.clipboard.dispose();
    if (this.paintFrame !== null)
      this.root.ownerDocument.defaultView?.cancelAnimationFrame(
        this.paintFrame
      );
    this.openingSpan?.end();
    this.openingSpan = undefined;
    this.observer.disconnect();
    for (const timer of this.cleanupTimers) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.events.dispose();
    this.presence.dispose();
    for (const decorator of this.decorators.values()) decorator.dispose();
    this.decorators.clear();
    for (const table of this.tables.values()) table.dispose();
    this.tables.clear();
    roots.delete(this.root);
    this.dom.clear();
    this.viewCommands.clear();
    this.commits.clear();
    this.mutations.clear();
    this.histories.clear();
    this.decoratorListeners.clear();
  }
}
