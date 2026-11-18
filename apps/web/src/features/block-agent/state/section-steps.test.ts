import type {
  ActivityRow,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { sectionSteps } from './section-steps';

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;
const call = (id: string, overrides?: Partial<ToolUsePart>): ToolUsePart => ({
  kind: 'tool_use',
  id,
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: [`${id}.rs`] },
  ...overrides,
});
const program = (id: string): ToolUsePart =>
  call(id, {
    name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
    status: 'running',
  });
const row = (
  id: string,
  label: string,
  status: ActivityRow['status'] = 'completed',
  detail: string | null = null
): ActivityRow => ({ id, label, detail, status, card: null });

describe('sectionSteps', () => {
  it('reads each call as its fold row and what it acted on, in order', () => {
    expect(
      sectionSteps({
        parts: [call('a'), { kind: 'thought', text: 'hm' }, call('b')],
        rows: [
          row('elsewhere', 'Ran', 'completed', 'ls'),
          row('a', 'Read', 'completed', 'a.rs'),
          row('b', 'Searching', 'running'),
        ],
        observed: () => undefined,
        thinking: false,
      })
    ).toEqual([
      { id: 'a', label: 'Read a.rs', status: 'completed' },
      { id: 'b', label: 'Searching', status: 'running' },
    ]);
  });

  it("reads a program as its observed operations, else its receipt's rows", () => {
    const parts = [program('p'), program('q')];
    const rows = [
      row('p', 'Working in your workspace', 'running'),
      row('q:0', 'Listed tasks'),
      row('q:1', 'Update task failed', 'failed'),
    ];
    expect(
      sectionSteps({
        parts,
        rows,
        observed: (id) =>
          id === 'p'
            ? [
                { id: 0, label: 'Searched documents', status: 'completed' },
                { id: 1, label: 'Reading a document', status: 'running' },
                { id: 2, label: 'Opening a link', status: 'unknown' },
              ]
            : [],
        thinking: false,
      })
    ).toEqual([
      { id: 'p:0', label: 'Searched documents', status: 'completed' },
      { id: 'p:1', label: 'Reading a document', status: 'running' },
      { id: 'p:2', label: 'Opening a link', status: 'interrupted' },
      { id: 'q:0', label: 'Listed tasks', status: 'completed' },
      { id: 'q:1', label: 'Update task failed', status: 'failed' },
    ]);
  });

  it('leaves out the lookups people never see', () => {
    expect(
      sectionSteps({
        parts: [
          call('lookup', {
            name: {
              kind: 'mcp',
              server: 'macro_internal',
              tool: 'SearchTools',
            },
          }),
          call('a'),
        ],
        rows: [row('lookup', 'Search tools'), row('a', 'Read')],
        observed: () => undefined,
        thinking: false,
      }).map((step) => step.id)
    ).toEqual(['a']);
  });

  it('ends with Thinking while the tail thought streams', () => {
    expect(
      sectionSteps({
        parts: [call('a'), { kind: 'thought', text: 'next' }],
        rows: [row('a', 'Read')],
        observed: () => undefined,
        thinking: true,
      }).at(-1)
    ).toEqual({ id: 'thinking', label: 'Thinking', status: 'running' });
  });

  it('says Working before any step names itself', () => {
    expect(
      sectionSteps({
        parts: [call('a', { status: 'pending' })],
        rows: [],
        observed: () => undefined,
        thinking: false,
      })
    ).toEqual([{ id: 'working', label: 'Working', status: 'running' }]);
  });
});
