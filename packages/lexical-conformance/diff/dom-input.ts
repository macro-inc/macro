import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import {
  consumeSelectionChangeFromDOMUpdate,
  markSelectionChangeFromDOMUpdate,
} from '../../lexical-wasm-view/src/view/selection-change';
import type { Command, Position, Snapshot } from './commands';
import { RustCore } from './loader';

type SerializedNode = {
  type: string;
  text?: string;
  children?: SerializedNode[];
};
type Range = { type: 'range'; anchor: Position; focus: Position };
type DOMSnapshot = Snapshot & {
  state: { root: SerializedNode };
  selection: Range | { type: 'null' } | null;
};

/**
 * WP-07's raw core has no DOM event dispatcher. This sidecar independently
 * projects its keyed snapshot into an isolated document for DOM-input commands.
 * Hydration notifications are withheld, just like the pinned oracle's hydration;
 * the actual production selection-change guard decides input admission. The
 * CoreHandle loader remains available unchanged for direct model-only checks.
 */
let nextTrace = 0;

export class DOMInputCore {
  private readonly traceId = ++nextTrace;
  readonly events: {
    input: string;
    skipped: boolean;
    admitted: boolean;
    coalesced: boolean;
    trusted: boolean;
  }[] = [];
  private readonly core: InstanceType<typeof RustCore>;
  private readonly frame = document.createElement('iframe');
  private readonly root: HTMLElement;
  private readonly document: Document;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly texts = new Map<string, Text>();

  constructor(profile: string, seed?: string) {
    this.core = new RustCore(profile, seed);
    document.body.append(this.frame);
    const doc = this.frame.contentDocument;
    if (!doc) throw new Error('Missing native DOM-input document');
    this.document = doc;
    this.root = doc.createElement('div');
    doc.body.append(this.root);
  }

  snapshot(): string {
    return this.core.snapshot();
  }
  state_json(): string {
    return this.core.state_json();
  }
  free(): void {
    const directory = process.env.DIFF_DOM_EVENTS_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, `${process.pid}-${this.traceId}.json`),
        JSON.stringify({
          schemaVersion: 1,
          mode: 'logical-command-gate-not-production-admission-counts',
          events: this.events,
        }) + '\n'
      );
    }
    this.core.free();
    this.frame.remove();
  }

  private project(snapshot: DOMSnapshot): void {
    const keys = new Map(
      snapshot.keys.map((entry) => [entry.path.join('/'), entry.key])
    );
    const render = (node: SerializedNode, path: number[]): HTMLElement => {
      const key = keys.get(path.join('/'));
      if (key === undefined) throw new Error('Missing native projection key');
      let element = this.elements.get(key);
      if (!element) {
        element =
          path.length === 0
            ? this.root
            : this.document.createElement(
                node.type === 'linebreak'
                  ? 'br'
                  : node.type === 'paragraph'
                    ? 'p'
                    : 'span'
              );
        this.elements.set(key, element);
      }
      const children: Node[] = [];
      if (node.text !== undefined) {
        let text = this.texts.get(key);
        if (!text) {
          text = this.document.createTextNode(node.text);
          this.texts.set(key, text);
        } else if (text.nodeValue !== node.text) text.nodeValue = node.text;
        children.push(text);
      } else
        node.children?.forEach((child, index) =>
          children.push(render(child, [...path, index]))
        );
      children.forEach((child, index) => {
        if (element.childNodes[index] !== child)
          element.insertBefore(child, element.childNodes[index] ?? null);
      });
      while (element.childNodes.length > children.length)
        element.lastChild?.remove();
      return element;
    };
    render(snapshot.state.root, []);
    const selection = this.document.getSelection();
    if (!selection || snapshot.selection?.type !== 'range') return;
    const anchor = this.resolve(snapshot, snapshot.selection.anchor);
    const focus = this.resolve(snapshot, snapshot.selection.focus);
    if (!anchor || !focus) return;
    if (
      selection.anchorNode !== anchor[0] ||
      selection.anchorOffset !== anchor[1] ||
      selection.focusNode !== focus[0] ||
      selection.focusOffset !== focus[1]
    ) {
      selection.setBaseAndExtent(...anchor, ...focus);
      markSelectionChangeFromDOMUpdate();
    }
  }

  private resolve(
    snapshot: DOMSnapshot,
    point: Position
  ): [Node, number] | null {
    const key = snapshot.keys.find(
      (entry) =>
        entry.path.length === point.path.length &&
        entry.path.every((part, index) => part === point.path[index])
    )?.key;
    if (key === undefined) return null;
    const node =
      point.type === 'text' ? this.texts.get(key) : this.elements.get(key);
    return node ? [node, point.offset] : null;
  }

  async apply(input: string, now: number): Promise<string> {
    const command: Command = JSON.parse(input);
    if (command.kind !== 'SelectionFromView' && command.kind !== 'TextFromView')
      return this.core.apply(input, now);
    if (
      command.kind === 'SelectionFromView' &&
      Object.keys(command).some(
        (key) => !['kind', 'anchor', 'focus'].includes(key)
      )
    ) {
      throw new Error('Unsupported native logical-input selection context');
    }
    const snapshot: DOMSnapshot = JSON.parse(this.core.snapshot());
    this.project(snapshot);
    // Hydration events are outside input, just as in the pinned oracle.
    await vi.runAllTimersAsync();
    const selection = this.document.getSelection();
    if (!selection) throw new Error('Missing native DOM selection');
    if (command.kind === 'SelectionFromView') {
      const anchor = this.resolve(snapshot, command.anchor);
      const focus = this.resolve(snapshot, command.focus);
      if (!anchor || !focus) return this.core.apply(input, now);
      let result = JSON.stringify({ ...snapshot, commit: null, error: null });
      let admittedPayload: string | undefined;
      let routingError: Error | undefined;
      const dispatch = (event: Event) => {
        const skipped = consumeSelectionChangeFromDOMUpdate(selection, false);

        const decision = {
          input,
          skipped,
          admitted: false,
          coalesced: false,
          trusted: event.isTrusted,
        };
        this.events.push(decision);
        if (skipped) return;
        // This is a logical-command gate, NOT production per-event admission
        // parity. The raw API includes peer hydration in every call. Coalesce
        // only identical notifications; fail closed on any changed DOM payload.
        if (
          selection.anchorNode !== anchor[0] ||
          selection.anchorOffset !== anchor[1] ||
          selection.focusNode !== focus[0] ||
          selection.focusOffset !== focus[1]
        ) {
          routingError = new Error(
            'Native logical-input route received changed accepted DOM endpoints'
          );
          return;
        }
        const payload = JSON.stringify({
          input: command,
          postDeleteRestore: false,
        });
        if (admittedPayload !== undefined) {
          if (admittedPayload !== payload)
            routingError = new Error(
              'Native logical-input route cannot coalesce changed context'
            );
          else decision.coalesced = true;
          return;
        }
        result = this.core.apply(input, now);
        decision.admitted = true;
        admittedPayload = payload;
      };
      this.document.addEventListener('selectionchange', dispatch);
      try {
        selection.setBaseAndExtent(...anchor, ...focus);
        this.document.dispatchEvent(new Event('selectionchange'));
        // DOM range-bound changes schedule an additional jsdom event; direction
        // reversal alone does not. Never manufacture or suppress that event.
        await vi.runAllTimersAsync();
        if (routingError) throw routingError;
        return result;
      } finally {
        this.document.removeEventListener('selectionchange', dispatch);
      }
    }
    if (command.kind !== 'TextFromView')
      throw new Error('Unexpected native DOM-input command');
    const point = this.resolve(snapshot, {
      path: command.path,
      type: 'text',
      offset: 0,
    });
    if (point) {
      point[0].nodeValue = command.text;
      selection.setBaseAndExtent(
        point[0],
        command.anchor,
        point[0],
        command.focus
      );
    }
    return this.core.apply(input, now);
  }
}
