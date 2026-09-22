/**
 * Where a message's parts fold for display: a run of two or more consecutive
 * tool calls and thinking blocks reads as one collapsed row (`ui/ToolGroup`),
 * everything else as itself. A lone call stays a card of its own — a group of
 * one would hide the call behind a count that says nothing the card did not.
 * DisplayResults is inline answer content and always breaks the run, including
 * while its arguments are still arriving.
 *
 * A thought at the tail of a run stays out of the group only when the run
 * closes the message: that row is the current (or last) reasoning, and
 * burying it in "Called N tools" is what made a live Cursor turn look
 * finished. Mid-message, a trailing thought belongs to its run — prose
 * follows it, so nothing live is being hidden.
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
  if (part?.kind !== 'tool_use') return false;
  const macroTool =
    part.detail.kind === 'macro' ||
    (part.detail.kind === 'other' &&
      part.name.kind === 'mcp' &&
      part.name.server === 'macro');
  if (!macroTool) return false;
  // The tool's own name, without the MCP server namespace the fold already
  // separated out (mirrors `toolLabel` in `component/parts/shared.ts`).
  const name = part.name.kind === 'mcp' ? part.name.tool : part.name.name;
  return SELF_RENDERING_TOOLS.has(name);
}

/** Whether a part may be folded into a collapsed run with its neighbours. */
function isGroupable(part: MessagePart | undefined): boolean {
  return (
    (part?.kind === 'tool_use' || part?.kind === 'thought') &&
    !rendersOwnView(part)
  );
}

export function segmentParts(parts: readonly MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let start = 0;
  while (start < parts.length) {
    let end = start + 1;
    if (isGroupable(parts[start])) {
      while (isGroupable(parts[end])) end += 1;
      if (
        end - start >= 2 &&
        end === parts.length &&
        parts[end - 1]?.kind === 'thought'
      ) {
        end -= 1;
      }
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
