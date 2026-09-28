/**
 * Where a message's parts fold for display: consecutive ordinary tool calls
 * and their thinking blocks share a group, everything else stays visible.
 * The group starts with the first call so receiving another call does not
 * replace the first call's host in the middle of its animation.
 * Subagents and user tools stay outside groups so delegated work and user
 * interactions remain visible regardless of the surrounding tool traffic.
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
    part?.kind === 'thought' ||
    (part?.kind === 'tool_use' &&
      part.detail.kind !== 'subagent' &&
      part.detail.kind !== 'user_tool' &&
      !rendersOwnView(part))
  );
}

export function segmentParts(parts: readonly MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let start = 0;
  while (start < parts.length) {
    if (!isGroupable(parts[start])) {
      segments.push({ kind: 'part', start, end: start + 1 });
      start += 1;
      continue;
    }

    let end = start;
    let lastCallEnd = start;
    while (isGroupable(parts[end])) {
      if (parts[end].kind === 'tool_use') lastCallEnd = end + 1;
      end += 1;
    }
    if (lastCallEnd > start) {
      const groupEnd = end === parts.length ? lastCallEnd : end;
      segments.push({ kind: 'tools', start, end: groupEnd });
      start = groupEnd;
    }
    // At the message tail, every thought after the last call remains visible.
    // Thought-only runs never become groups: a group needs an actual call.
    while (start < end) {
      segments.push({ kind: 'part', start, end: start + 1 });
      start += 1;
    }
  }
  return segments;
}
