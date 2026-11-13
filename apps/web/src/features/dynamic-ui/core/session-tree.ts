/** A session placed in its agent's tree, with the sub-agents it started. */
export type SessionNode<T> = { session: T; children: SessionNode<T>[] };

/**
 * The sessions as a tree: a session whose parent is also listed sits under
 * it, every other session is a root. Order is kept at every level, so roots
 * and siblings stay newest first. At most `limit` roots; children are not
 * counted against it. A parent cycle (which lineage never forms) falls back
 * to roots.
 */
export function buildSessionTree<T extends { id: string }>(
  sessions: readonly T[],
  parentOf: (session: T) => string | undefined,
  limit: number
): SessionNode<T>[] {
  const listed = new Set(sessions.map((session) => session.id));
  const nodes = new Map(
    sessions.map((session): [string, SessionNode<T>] => [
      session.id,
      { session, children: [] },
    ])
  );
  const parentIn = (session: T) => {
    const parent = parentOf(session);
    return parent && parent !== session.id && listed.has(parent)
      ? parent
      : undefined;
  };
  const inCycle = (session: T) => {
    const seen = new Set([session.id]);
    let parent = parentIn(session);
    while (parent) {
      if (seen.has(parent)) return true;
      seen.add(parent);
      const next = nodes.get(parent);
      parent = next ? parentIn(next.session) : undefined;
    }
    return false;
  };
  const roots: SessionNode<T>[] = [];
  for (const session of sessions) {
    const node = nodes.get(session.id);
    if (!node) continue;
    const parent = inCycle(session) ? undefined : parentIn(session);
    const parentNode = parent ? nodes.get(parent) : undefined;
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  return roots.slice(0, limit);
}

/**
 * The session that started this one, from its trigger origin: an agent
 * caller's lineage names the acting session. Anything else has none.
 */
export function parentSessionOf(origin: unknown): string | undefined {
  if (!isRecord(origin)) return undefined;
  const by = origin.by;
  if (!isRecord(by)) return undefined;
  const lineage = by.lineage;
  if (!isRecord(lineage) || lineage.type !== 'session') return undefined;
  return typeof lineage.session === 'string' ? lineage.session : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
