import type { INodeCursorMsg } from '@macro-inc/collaboration/session/abi.generated';

/** Durable cursors and the exact model text a comment publication must match. */
export interface CommentSelection {
  readonly anchor: INodeCursorMsg;
  readonly focus: INodeCursorMsg;
  readonly text: string;
}

function bytes(value: unknown): Uint8Array {
  if (
    !Array.isArray(value) ||
    !value.every(
      (byte) =>
        typeof byte === 'number' &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255
    )
  )
    throw new Error('Invalid native selection cursor bytes');
  return Uint8Array.from(value);
}

function cursor(value: unknown): INodeCursorMsg {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('nodeId' in value) ||
    typeof value.nodeId !== 'string' ||
    !('cursor' in value)
  )
    throw new Error('Invalid native selection cursor');
  return { nodeId: value.nodeId, cursor: bytes(value.cursor) };
}

/** Query kind 12 text: kind 8's JSON shape, cursor bytes as numbers. */
export function encodeCommentSelectionCursors(
  selection: CommentSelection,
  markId?: string
) {
  const encode = (cursor: INodeCursorMsg) => ({
    nodeId: cursor.nodeId,
    cursor: [...cursor.cursor],
  });
  return JSON.stringify({
    anchor: encode(selection.anchor),
    focus: encode(selection.focus),
    ...(markId === undefined ? {} : { markId }),
  });
}

/** Parse the session's selection-cursor query (kind 8); null without a selection. */
export function parseCommentSelection(
  nodes: readonly string[],
  text: string
): CommentSelection | null {
  const [encoded] = nodes;
  if (encoded === undefined) return null;
  const value: unknown = JSON.parse(encoded);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('anchor' in value) ||
    !('focus' in value)
  )
    throw new Error('Invalid native selection cursors');
  return { anchor: cursor(value.anchor), focus: cursor(value.focus), text };
}
