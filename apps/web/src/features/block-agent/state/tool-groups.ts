/**
 * Where a message's parts fold for display: a run of two or more consecutive
 * tool calls reads as one collapsed row (`ui/ToolGroup`), everything else as
 * itself. A lone call stays a card of its own — a group of one would hide the
 * call behind a count that says nothing the card did not.
 *
 * Segments are half-open index ranges into the parts array, so a grouped call
 * keeps its position for the tool render context.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';

export type PartSegment = {
  kind: 'part' | 'tools';
  start: number;
  /** Exclusive. A `part` segment spans exactly one index. */
  end: number;
};

/**
 * Macro tools whose call renders the answer itself rather than a card about
 * it: `DisplayResults` renders the dynamic-UI view the model composed, the
 * same full-width dashboard the chat shows.
 *
 * Folding one of these into a group would put the answer behind a closed
 * caret, indented inside a row of muted tool chips — so they break the run
 * and stand on their own, like a paragraph of the reply.
 */
const SELF_RENDERING_TOOLS: ReadonlySet<string> = new Set(['DisplayResults']);

/**
 * Whether a part is a tool call that renders its own view (see
 * {@link SELF_RENDERING_TOOLS}). Only Macro's own tools do: the fold names
 * them, and the chat component library is what renders them.
 */
export function rendersOwnView(part: MessagePart | undefined): boolean {
  if (part?.kind !== 'tool_use' || part.detail.kind !== 'macro') return false;
  // The tool's own name, without the MCP server namespace the fold already
  // separated out (mirrors `toolLabel` in `component/parts/shared.ts`).
  const name = part.name.kind === 'mcp' ? part.name.tool : part.name.name;
  return SELF_RENDERING_TOOLS.has(name);
}

/** Whether a part may be folded into a collapsed run with its neighbours. */
function groupable(part: MessagePart | undefined): boolean {
  return part?.kind === 'tool_use' && !rendersOwnView(part);
}

export function segmentParts(parts: readonly MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let start = 0;
  while (start < parts.length) {
    let end = start + 1;
    if (groupable(parts[start])) {
      while (groupable(parts[end])) end += 1;
    }
    segments.push({
      kind: end - start >= 2 ? 'tools' : 'part',
      start,
      end,
    });
    start = end;
  }
  return segments;
}
