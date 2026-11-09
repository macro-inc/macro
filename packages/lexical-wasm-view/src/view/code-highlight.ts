import { type Span, Telemetry } from '@macro-inc/observability';
import Prism from 'prismjs';
import { textLeaf } from './dom';
import type { CommitInfo, EditorView } from './editor-view';

interface PublishedHighlight {
  readonly value: Highlight;
  readonly owners: Map<symbol, readonly Range[]>;
}
const highlights = new WeakMap<Document, Map<string, PublishedHighlight>>();
function publish(
  view: EditorView,
  name: string,
  owner: symbol,
  ranges: readonly Range[]
): void {
  const doc = view.root.ownerDocument;
  const window = doc.defaultView;
  if (!window?.CSS.highlights || !window.Highlight) return;
  let names = highlights.get(doc);
  if (!names) {
    names = new Map();
    highlights.set(doc, names);
  }
  let entry = names.get(name);
  if (!entry) {
    if (!ranges.length) return;
    entry = { value: new window.Highlight(), owners: new Map() };
    names.set(name, entry);
    window.CSS.highlights.set(name, entry.value);
  }
  for (const old of entry.owners.get(owner) ?? []) entry.value.delete(old);
  if (ranges.length) {
    entry.owners.set(owner, ranges);
    for (const range of ranges) entry.value.add(range);
    if (window.CSS.highlights.get(name) !== entry.value)
      window.CSS.highlights.set(name, entry.value);
  } else entry.owners.delete(owner);
  if (!entry.owners.size) {
    window.CSS.highlights.delete(name);
    names.delete(name);
  }
}

interface TokenRange {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}
function tokenRanges(
  tokens: (string | Prism.Token)[],
  output: TokenRange[],
  offset = 0
): number {
  for (const token of tokens) {
    if (typeof token === 'string') {
      offset += token.length;
      continue;
    }
    const start = offset;
    offset = tokenRanges(
      typeof token.content === 'string'
        ? [token.content]
        : Array.isArray(token.content)
          ? token.content
          : [token.content],
      output,
      offset
    );
    output.push({ type: token.type, start, end: offset });
  }
  return offset;
}
/** Call from the host's lazy editor path. Never changes model nodes. */
export function installCodeHighlighting(view: EditorView): () => void {
  const browser = view.root.ownerDocument.defaultView;
  if (!browser) throw new Error('Highlighting requires an owning window');
  const window = browser;
  const hasIdle = typeof window.requestIdleCallback === 'function';
  const pending = new Set<number>();
  const painted = new Map<
    number,
    { owner: symbol; tokens: Map<string, Range[]> }
  >();
  let idle: number | null = null;
  let frame: number | null = null;
  let disposed = false;
  let context = Telemetry.captureContext();
  function dirty(key: number, commit?: CommitInfo, previous = false): void {
    let node = previous
      ? (commit?.mutations.get(key)?.before ?? view.node(key))
      : view.node(key);
    while (node) {
      if (node.type === 'code' || node.type === 'custom-code') {
        pending.add(node.key);
        return;
      }
      if (node.parent === null) return;
      node = previous
        ? (commit?.mutations.get(node.parent)?.before ?? view.node(node.parent))
        : view.node(node.parent);
    }
  }
  function release(key: number): void {
    const previous = painted.get(key);
    if (!previous) return;
    for (const type of previous.tokens.keys())
      publish(
        view,
        `code-${view.options.namespace}-${type}`,
        previous.owner,
        []
      );
    painted.delete(key);
  }
  function schedule(): void {
    if (frame !== null || idle !== null || !pending.size || disposed) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (hasIdle) idle = window.requestIdleCallback(paint);
      else paint();
    });
  }
  function paint(): void {
    context.run(() => {
      const span = Telemetry.span('view.code_highlight', { sampling: 'perf' });
      span.setAttr('editor.namespace', view.options.namespace);
      try {
        paintBlock(span);
      } catch (error) {
        span.error(error instanceof Error ? error.name : 'UnknownError');
        throw error;
      } finally {
        span.end();
      }
    });
  }
  function paintBlock(span: Span): void {
    idle = null;
    const key = pending.values().next().value;
    if (key === undefined || disposed) return;
    pending.delete(key);
    span.setAttr('blocks.processed', 1);
    const block = view.node(key),
      element = view.getElementByKey(key);
    if (
      !block ||
      !element ||
      (block.type !== 'code' && block.type !== 'custom-code')
    )
      release(key);
    else {
      const segments: { node: Text; start: number; end: number }[] = [];
      let text = '';
      const walk = (key: number) => {
        const node = view.node(key);
        if (!node) return;
        if (node.kind === 'text') {
          const dom = textLeaf(view.getElementByKey(key));
          if (dom instanceof Text)
            segments.push({
              node: dom,
              start: text.length,
              end: text.length + node.text.length,
            });
          text += node.text;
        } else if (node.kind === 'linebreak') text += '\n';
        else for (const child of node.children) walk(child);
      };
      walk(key);
      element.setAttribute('data-line-count', String(text.split('\n').length));
      const language = block.props().language;
      const grammar =
        typeof language === 'string' ? Prism.languages[language] : undefined;
      const tokens: TokenRange[] = [];
      if (grammar) tokenRanges(Prism.tokenize(text, grammar), tokens);
      const ranges = new Map<string, Range[]>();
      for (const token of tokens) {
        const start = segments.find(
          (part) => part.start <= token.start && part.end > token.start
        );
        const end = segments.find(
          (part) => part.start < token.end && part.end >= token.end
        );
        if (!start || !end) continue;
        const range = view.root.ownerDocument.createRange();
        range.setStart(start.node, token.start - start.start);
        range.setEnd(end.node, token.end - end.start);
        const list = ranges.get(token.type) ?? [];
        list.push(range);
        ranges.set(token.type, list);
      }
      span.setAttr(
        'ranges.created',
        [...ranges.values()].reduce((total, values) => total + values.length, 0)
      );
      const previous = painted.get(key);
      const owner = previous?.owner ?? Symbol();
      for (const type of previous?.tokens.keys() ?? [])
        if (!ranges.has(type))
          publish(view, `code-${view.options.namespace}-${type}`, owner, []);
      for (const [type, values] of ranges)
        publish(view, `code-${view.options.namespace}-${type}`, owner, values);
      painted.set(key, { owner, tokens: ranges });
    }
    schedule();
  }
  const detach = view.onCommit((info) => {
    context = Telemetry.captureContext();
    if (info.fullReconcile) {
      for (const key of painted.keys()) release(key);
      pending.clear();
    }
    for (const key of info.keys) {
      if (!info.fullReconcile) dirty(key, info, true);
      dirty(key, info);
    }
    schedule();
  });
  for (const node of view.mirror.values()) dirty(node.key);
  schedule();
  return () => {
    disposed = true;
    detach();
    if (idle !== null) window.cancelIdleCallback(idle);
    if (frame !== null) window.cancelAnimationFrame(frame);
    for (const key of painted.keys()) release(key);
  };
}
