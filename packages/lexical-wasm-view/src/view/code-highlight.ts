import Prism from 'prismjs';
import type { EditorView } from './editor-view';

const highlights = new WeakMap<
  Document,
  Map<string, Map<symbol, readonly Range[]>>
>();
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
  let owners = names.get(name);
  if (!owners) {
    owners = new Map();
    names.set(name, owners);
  }
  if (ranges.length) owners.set(owner, ranges);
  else owners.delete(owner);
  if (owners.size)
    window.CSS.highlights.set(
      name,
      new window.Highlight(...[...owners.values()].flat())
    );
  else {
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
  const painted = new Map<number, Map<string, Range[]>>();
  const names = new Set<string>();
  const owner = Symbol();
  let idle: number | null = null;
  let frame: number | null = null;
  let disposed = false;
  function dirty(key: number): void {
    for (
      let node = view.node(key);
      node;
      node = node.parent === null ? null : view.node(node.parent)
    ) {
      if (node.type === 'code' || node.type === 'custom-code') {
        pending.add(node.key);
        break;
      }
    }
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
    idle = null;
    const key = pending.values().next().value;
    if (key === undefined || disposed) return;
    pending.delete(key);
    const block = view.node(key),
      element = view.getElementByKey(key);
    if (!block || !element) painted.delete(key);
    else {
      const segments: { node: Text; start: number; end: number }[] = [];
      let text = '';
      const walk = (key: number) => {
        const node = view.node(key);
        if (!node) return;
        if (node.kind === 'text') {
          const dom = view.getElementByKey(key)?.firstChild;
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
      painted.set(key, ranges);
    }
    if ('highlights' in CSS) {
      for (const name of names) publish(view, name, owner, []);
      names.clear();
      const all = new Map<string, Range[]>();
      for (const [key, tokens] of painted) {
        if (!view.node(key)) {
          painted.delete(key);
          continue;
        }
        for (const [type, ranges] of tokens)
          all.set(type, [...(all.get(type) ?? []), ...ranges]);
      }
      for (const [type, ranges] of all) {
        const name = `code-${view.options.namespace}-${type}`;
        publish(view, name, owner, ranges);
        names.add(name);
      }
    }
    schedule();
  }
  const detach = view.onCommit((info) => {
    for (const key of info.keys) {
      if (!view.node(key) && painted.has(key)) pending.add(key);
      else dirty(key);
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
    for (const name of names) publish(view, name, owner, []);
  };
}
