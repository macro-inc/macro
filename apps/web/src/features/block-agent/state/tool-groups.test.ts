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
});
