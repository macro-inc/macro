import type { MessagePart } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { rendersOwnView, segmentParts } from './tool-groups';

const text = (): MessagePart => ({ kind: 'text', text: 'hi' });
const tool = (): MessagePart => ({
  kind: 'tool_use',
  id: 'call',
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: ['a.rs'] },
});
/**
 * `displayResults`: the model composes a dynamic-UI view and the call renders
 * it. The answer itself, not a card about one.
 */
const displayResults = (): MessagePart => ({
  kind: 'tool_use',
  id: 'view',
  name: { kind: 'native', name: 'DisplayResults' },
  status: 'completed',
  detail: {
    kind: 'macro',
    input: { view: { widgets: [] } },
    output: { message: 'done' },
    error: null,
  },
});
const permission = (): MessagePart => ({
  kind: 'permission',
  toolCall: 'call',
  options: [],
  outcome: { kind: 'pending' },
});

describe('segmentParts', () => {
  it('leaves a message without tool calls as one segment per part', () => {
    expect(segmentParts([text(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });

  it('keeps a lone tool call as its own part', () => {
    expect(segmentParts([text(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('folds a run of consecutive tool calls into one group', () => {
    expect(segmentParts([text(), tool(), tool(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('breaks a run at anything that is not a tool call', () => {
    // The permission prompt is waiting on the reader; it must stay visible.
    expect(
      segmentParts([tool(), tool(), permission(), tool(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });

  it('groups a run that closes the message', () => {
    expect(segmentParts([text(), tool(), tool()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 3 },
    ]);
  });

  it('is empty for no parts', () => {
    expect(segmentParts([])).toEqual([]);
  });

  // A collapsed group would put the composed view behind a closed caret,
  // indented in a row of muted chips — the one part of the turn the reader
  // actually came for.
  it('keeps a view-rendering call out of the run it interrupts', () => {
    expect(
      segmentParts([tool(), tool(), displayResults(), tool(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });

  it('keeps a view-rendering call alone even between single calls', () => {
    expect(segmentParts([tool(), displayResults(), tool()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('does not fold two view-rendering calls into each other', () => {
    expect(segmentParts([displayResults(), displayResults()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });
});

describe('rendersOwnView', () => {
  it('is true for a Macro displayResults call', () => {
    expect(rendersOwnView(displayResults())).toBe(true);
  });

  it('is false for any other tool call, and for a non-tool part', () => {
    expect(rendersOwnView(tool())).toBe(false);
    expect(rendersOwnView(text())).toBe(false);
    expect(rendersOwnView(undefined)).toBe(false);
  });

  // A harness tool that happens to share the name is not Macro's: the fold
  // decides whose shape a call is in, and only a `macro` detail carries the
  // tool's own arguments.
  it('is false for a same-named call the fold did not read as a Macro tool', () => {
    expect(
      rendersOwnView({
        kind: 'tool_use',
        id: 'other',
        name: { kind: 'native', name: 'DisplayResults' },
        status: 'completed',
        detail: { kind: 'other', acpKind: 'other', output: null, input: null },
      })
    ).toBe(false);
  });
});
