export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** R-5: count decoded unpaired UTF-16 units, including JSON object keys. */
export function scan_for_lone_surrogate_escapes(raw: string): number {
  function walk(value: unknown): number {
    if (typeof value === 'string') {
      let count = 0;
      for (let i = 0; i < value.length; i++) {
        const unit = value.charCodeAt(i);
        if (
          unit >= 0xd800 &&
          unit <= 0xdbff &&
          value.charCodeAt(i + 1) >= 0xdc00 &&
          value.charCodeAt(i + 1) <= 0xdfff
        )
          i++;
        else if (unit >= 0xd800 && unit <= 0xdfff) count++;
      }
      return count;
    }
    if (Array.isArray(value))
      return value.reduce((sum, child) => sum + walk(child), 0);
    if (object(value))
      return Object.entries(value).reduce(
        (sum, [key, child]) => sum + walk(key) + walk(child),
        0
      );
    return 0;
  }
  return walk(JSON.parse(raw));
}

export function nodes(value: unknown): Record<string, unknown>[] {
  if (!object(value)) return [];
  const root = object(value.root) ? value.root : value;
  const result = [root];
  if (Array.isArray(root.children))
    for (const child of root.children) result.push(...nodes(child));
  return result;
}

/** Values outside the known enum are counted together; never print arbitrary status strings. */
export function scan_magic_chip_status(value: unknown) {
  const result = { nodes: 0, missing: 0, null: 0, known: 0, other: 0 };
  for (const node of nodes(value)) {
    if (node.type !== 'magic-chip') continue;
    result.nodes++;
    if (!Object.hasOwn(node, 'status')) result.missing++;
    else if (node.status === null) result.null++;
    else if (
      typeof node.status === 'string' &&
      [
        'no_messages',
        'booting',
        'acp_ready',
        'shutting_down',
        'disconnected',
      ].includes(node.status)
    )
      result.known++;
    else result.other++;
  }
  return result;
}

/** Count parent keys that Rust drops without exposing arbitrary key names. */
export function scan_reply_target_parent_keys(value: unknown) {
  const result = {
    nodes: 0,
    missing: 0,
    invalid: 0,
    type: 0,
    id: 0,
    extraKeys: 0,
    parentsWithExtraKeys: 0,
  };
  for (const node of nodes(value)) {
    if (node.type !== 'reply-target') continue;
    result.nodes++;
    if (!Object.hasOwn(node, 'parent')) result.missing++;
    else if (!object(node.parent)) result.invalid++;
    else {
      if (Object.hasOwn(node.parent, 'type')) result.type++;
      if (Object.hasOwn(node.parent, 'id')) result.id++;
      const extra = Object.keys(node.parent).filter(
        (key) => key !== 'type' && key !== 'id'
      ).length;
      result.extraKeys += extra;
      if (extra) result.parentsWithExtraKeys++;
    }
  }
  return result;
}

export function scan(raw: string) {
  const state: unknown = JSON.parse(raw);
  return {
    loneSurrogates: scan_for_lone_surrogate_escapes(raw),
    magicChip: scan_magic_chip_status(state),
    replyTarget: scan_reply_target_parent_keys(state),
  };
}
