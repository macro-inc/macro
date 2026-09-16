/**
 * Where a message's parts fold for display: a run of two or more consecutive
 * tool calls and thinking blocks reads as one collapsed row (`ui/ToolGroup`),
 * everything else as itself. A lone call stays a card of its own — a group of
 * one would hide the call behind a count that says nothing the card did not.
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

function isGroupable(part: MessagePart | undefined): boolean {
  return part?.kind === 'tool_use' || part?.kind === 'thought';
}

export function segmentParts(parts: readonly MessagePart[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let start = 0;
  while (start < parts.length) {
    let end = start + 1;
    if (isGroupable(parts[start])) {
      while (isGroupable(parts[end])) end += 1;
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
