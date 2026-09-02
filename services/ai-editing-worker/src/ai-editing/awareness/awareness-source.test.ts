import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realAwarenessSource, resolveTextOwner } from './awareness-source';

// Duck-typed fake loro containers (kind/get), matching what resolveTextOwner reads.
function textC() {
  return {
    kind: () => 'Text',
    length: 10,
    getCursor: (offset: number) => ({
      encode: () => new Uint8Array([offset]),
    }),
  };
}
function mapC(id: string, fields: { text?: unknown; children?: unknown[] }) {
  return {
    kind: () => 'Map',
    get: (k: string) => {
      if (k === '$') return { getShallowValue: () => ({ id }) };
      if (k === 'text') return fields.text;
      if (k === 'children')
        return fields.children ? { toArray: () => fields.children } : undefined;
      return undefined;
    },
  };
}
function fakeLoro(containers: Record<string, unknown>) {
  const mirror = { getContainerIds: () => Object.keys(containers) } as any;
  const doc = { getContainerById: (cid: string) => containers[cid] } as any;
  return { mirror, doc };
}

describe('resolveTextOwner (cursor-walk fix)', () => {
  it('a text-node container resolves to itself', () => {
    const t = textC();
    const { mirror, doc } = fakeLoro({ c1: mapC('t1', { text: t }) });
    expect(resolveTextOwner(mirror, doc, 't1')).toEqual({
      text: t,
      nodeId: 't1',
    });
  });

  it('a block whose text lives in a child resolves to the CHILD text-node id', () => {
    const childText = textC();
    const block = mapC('b1', { children: [mapC('t2', { text: childText })] });
    const { mirror, doc } = fakeLoro({ c1: block });
    // block id in, but the owner is the child text node (so the caret can walk)
    expect(resolveTextOwner(mirror, doc, 'b1')).toEqual({
      text: childText,
      nodeId: 't2',
    });
  });

  it('finds text nested deeper than direct children (DFS): list item → paragraph → text', () => {
    const deepText = textC();
    const item = mapC('li1', {
      children: [mapC('p1', { children: [mapC('t9', { text: deepText })] })],
    });
    const { mirror, doc } = fakeLoro({ c1: item });
    expect(resolveTextOwner(mirror, doc, 'li1')).toEqual({
      text: deepText,
      nodeId: 't9',
    });
  });

  it('returns null for an unknown id or a block with no text anywhere', () => {
    const { mirror, doc } = fakeLoro({
      c1: mapC('b1', { children: [mapC('img', {})] }),
    });
    expect(resolveTextOwner(mirror, doc, 'missing')).toBeNull();
    expect(resolveTextOwner(mirror, doc, 'b1')).toBeNull();
  });
});

describe('realAwarenessSource (no live mirror)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops (no broadcast) when the node has no resolvable text container', () => {
    const send = vi.fn();
    const src = realAwarenessSource({
      mirror: { getContainerIds: () => [] } as any,
      doc: { getContainerById: () => null } as any,
      send,
      name: 'Sam (AI)',
      color: 'red',
    });
    src.apply({ type: 'cursor', node: 'missing', at: 0 });
    expect(send).not.toHaveBeenCalled();
    src.clear(); // no peers → still no broadcast, and no throw
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps live awareness alive until clear removes it', () => {
    const send = vi.fn();
    const { mirror, doc } = fakeLoro({ c1: mapC('t1', { text: textC() }) });
    const src = realAwarenessSource({
      mirror,
      doc,
      send,
      name: 'Sam (AI)',
      color: 'red',
    });

    src.apply({ type: 'cursor', node: 't1', at: 3 });
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_999);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);

    src.clear();
    vi.advanceTimersByTime(2_000);
    expect(send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('clears live awareness when the latest target no longer resolves', () => {
    const send = vi.fn();
    const { mirror, doc } = fakeLoro({ c1: mapC('t1', { text: textC() }) });
    const src = realAwarenessSource({
      mirror,
      doc,
      send,
      name: 'Sam (AI)',
      color: 'red',
    });

    src.apply({ type: 'cursor', node: 't1', at: 3 });
    expect(send).toHaveBeenCalledTimes(1);

    src.apply({ type: 'cursor', node: 'missing', at: 0 });
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
