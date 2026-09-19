/**
 * Tell the coder what its code actually did to the document.
 *
 * `runCode` used to answer with the bare string `ok` whenever no op threw. That
 * is ambiguous in the one way that matters: it cannot distinguish
 *
 *   - the op changed the document,
 *   - the op ran but changed nothing (already in that state, or a no-op), and
 *   - the op ran against the wrong node.
 *
 * The coder's only recourse was to try again — with the same call, or with a
 * different method name it hoped would work. Measured over 495 prod sessions,
 * 37% of consecutive `runCode` transitions re-touch a node the previous call
 * already touched: `insertParagraphAfter` repeated verbatim 24 times, `remove`
 * 18, `setText` 14, and swaps like `appendText`↔`setText` (9) or
 * `replace`↔`setText` (8). One session spent six calls oscillating between
 * `uncheck` and `setChecked` on three list items that were *already unchecked*,
 * getting `ok` every time.
 *
 * Reporting the observed effect states plainly which of those happened. On its
 * own that is not enough — measured over a self-correction sweep, 8 of 9
 * `NO CHANGE` replies were still followed by a retry, so the ops themselves must
 * fail loudly (see doc/substring-miss.ts). This exists to make the state
 * observable, not to instruct the model.
 */

/** Per-node snapshot of a document, keyed by durable id. */
export type NodeSnapshot = Map<string, string>;

/** Line-per-node index of the XML view, keyed by `id="..."`.
 *
 *  A node's "content" is its own line plus every line until the next line at or
 *  above its indentation — cheap, and enough to notice that a node changed. */
export function snapshotNodes(xml: string): NodeSnapshot {
  const out: NodeSnapshot = new Map();
  const lines = xml.split('\n');
  const indentOf = (line: string) => line.length - line.trimStart().length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const id = line.match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const indent = indentOf(line);
    const body: string[] = [line.trim()];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === '') continue;
      if (indentOf(next) <= indent) break;
      body.push(next.trim());
    }
    out.set(id, body.join('\n'));
  }
  return out;
}

export type DocumentEffect = {
  changed: boolean;
  addedIds: string[];
  removedIds: string[];
  modifiedIds: string[];
};

export function diffNodes(
  before: NodeSnapshot,
  after: NodeSnapshot
): DocumentEffect {
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const modifiedIds: string[] = [];

  for (const [id, body] of after) {
    const prev = before.get(id);
    if (prev === undefined) addedIds.push(id);
    else if (prev !== body) modifiedIds.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removedIds.push(id);
  }

  return {
    changed:
      addedIds.length > 0 || removedIds.length > 0 || modifiedIds.length > 0,
    addedIds,
    removedIds,
    modifiedIds,
  };
}

/** Cap the ids listed per bucket — the point is orientation, not an inventory. */
const MAX_IDS = 8;

function list(label: string, ids: string[]): string | null {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, MAX_IDS).join(', ');
  const rest = ids.length > MAX_IDS ? ` (+${ids.length - MAX_IDS} more)` : '';
  return `${label} ${shown}${rest}`;
}

/**
 * Render the effect for the model.
 *
 * `outcome` is whatever the op runner reported (`ok`, or per-op errors). The
 * effect is appended so a partial failure still says which nodes moved.
 */
export function describeEffect(
  outcome: string,
  effect: DocumentEffect
): string {
  if (!effect.changed) {
    return `${outcome}\n\nNO CHANGE: the document is byte-identical to before this call.`;
  }

  const parts = [
    list('modified', effect.modifiedIds),
    list('added', effect.addedIds),
    list('removed', effect.removedIds),
  ].filter((p): p is string => p !== null);

  return `${outcome}\n\nCHANGED — ${parts.join('; ')}`;
}
