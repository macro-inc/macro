import type { MessagePart } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { segmentParts } from './tool-groups';

const text = (): MessagePart => ({ kind: 'text', text: 'hi' });
const tool = (): MessagePart => ({
  kind: 'tool_use',
  id: 'call',
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: ['a.rs'] },
});
const thought = (): MessagePart => ({ kind: 'thought', text: 'thinking...' });
const permission = (): MessagePart => ({
  kind: 'permission',
  requestId: 'permission-test',
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

  it('groups thinking blocks with tool calls', () => {
    expect(segmentParts([text(), thought(), tool(), tool(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'tools', start: 1, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('groups consecutive thinking blocks with tool calls', () => {
    expect(
      segmentParts([thought(), tool(), thought(), tool(), thought()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 4 },
      { kind: 'part', start: 4, end: 5 },
    ]);
  });

  it('leaves a trailing thought out of a tool run', () => {
    expect(segmentParts([thought(), tool(), thought()])).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('leaves a thought after a single tool as its own part', () => {
    expect(segmentParts([tool(), thought()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
    ]);
  });

  it('keeps a lone thinking block as its own part', () => {
    expect(segmentParts([text(), thought(), text()])).toEqual([
      { kind: 'part', start: 0, end: 1 },
      { kind: 'part', start: 1, end: 2 },
      { kind: 'part', start: 2, end: 3 },
    ]);
  });

  it('groups thinking blocks at the start with tool calls', () => {
    expect(segmentParts([thought(), thought(), tool()])).toEqual([
      { kind: 'tools', start: 0, end: 3 },
    ]);
  });

  it('breaks a run at permissions even with thinking blocks', () => {
    expect(
      segmentParts([thought(), tool(), permission(), thought(), tool()])
    ).toEqual([
      { kind: 'tools', start: 0, end: 2 },
      { kind: 'part', start: 2, end: 3 },
      { kind: 'tools', start: 3, end: 5 },
    ]);
  });
});
