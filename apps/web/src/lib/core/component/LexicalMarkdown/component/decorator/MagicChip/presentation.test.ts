import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { deriveMagicChipPresentation } from './presentation';

const response = (overrides: Partial<FoldedMessage> = {}): FoldedMessage => ({
  agentSessionId: 'session',
  requestId: null,
  turn: 0,
  author: { kind: 'agent' },
  parts: [{ kind: 'thought', text: 'Inspecting the repository' }],
  stop: null,
  ...overrides,
});

describe('deriveMagicChipPresentation', () => {
  it('renders immediately from persisted booting state', () => {
    expect(
      deriveMagicChipPresentation({ persistedStatus: 'booting' })
    ).toMatchObject({
      kind: 'working',
      activity: { label: 'Booting agent', busy: true },
    });
  });

  it('shows thought activity before answer text exists', () => {
    expect(
      deriveMagicChipPresentation({
        persistedStatus: 'booting',
        response: response(),
      })
    ).toEqual({
      kind: 'working',
      activity: {
        label: 'Thinking',
        detail: 'Inspecting the repository',
        busy: true,
      },
    });
  });

  it('prefers a running tool over a later completed tool', () => {
    const presentation = deriveMagicChipPresentation({
      persistedStatus: 'booting',
      response: response({
        parts: [
          {
            kind: 'tool_use',
            rawInput: null,
            rawOutput: null,
            id: 'running',
            label: 'Terminal',
            status: 'running',
            detail: {
              kind: 'terminal',
              command: 'cargo test',
              output: null,
              exitCode: null,
            },
          },
          {
            kind: 'tool_use',
            rawInput: null,
            rawOutput: null,
            id: 'done',
            label: 'Read',
            status: 'completed',
            detail: { kind: 'read', paths: ['README.md'] },
          },
        ],
      }),
    });

    expect(presentation).toMatchObject({
      kind: 'working',
      activity: {
        label: 'Running command',
        detail: 'cargo test',
        busy: true,
      },
    });
  });

  it.each([
    ['pending', 'Permission needed'],
    ['errored', 'Permission failed'],
    ['unrecognized', 'Permission unavailable'],
  ] as const)(
    'prioritizes %s permission state over its pending tool',
    (kind, label) => {
      const presentation = deriveMagicChipPresentation({
        persistedStatus: 'acp_ready',
        response: response({
          parts: [
            {
              kind: 'tool_use',
              rawInput: null,
              rawOutput: null,
              id: 'tool',
              label: 'Terminal',
              status: 'pending',
              detail: {
                kind: 'terminal',
                command: 'cargo test',
                output: null,
                exitCode: null,
              },
            },
            {
              kind: 'permission',
              toolCall: 'tool',
              options: [],
              outcome: { kind },
            },
          ],
        }),
      });

      expect(presentation).toMatchObject({
        kind: 'working',
        activity: { label, busy: false },
      });
    }
  );

  it('shows the answer as it is written, before the turn ends', () => {
    const presentation = deriveMagicChipPresentation({
      persistedStatus: 'acp_ready',
      response: response({ parts: [{ kind: 'text', text: 'Looking at t' }] }),
    });

    expect(presentation).toEqual({
      kind: 'answering',
      markdown: 'Looking at t',
      activity: { label: 'Writing response', busy: true },
    });
  });

  it('keeps the answer visible while a tool runs mid-turn', () => {
    // Prose, then a tool call: the text stays and the activity says what the
    // agent moved on to, rather than the answer vanishing until it resumes.
    const presentation = deriveMagicChipPresentation({
      persistedStatus: 'acp_ready',
      response: response({
        parts: [
          { kind: 'text', text: 'Let me check the tests.' },
          {
            kind: 'tool_use',
            rawInput: null,
            rawOutput: null,
            id: 'running',
            label: 'Terminal',
            status: 'running',
            detail: {
              kind: 'terminal',
              command: 'cargo test',
              output: null,
              exitCode: null,
            },
          },
        ],
      }),
    });

    expect(presentation).toEqual({
      kind: 'answering',
      markdown: 'Let me check the tests.',
      activity: { label: 'Running command', detail: 'cargo test', busy: true },
    });
  });

  it('keeps partial prose when a turn is cancelled', () => {
    const presentation = deriveMagicChipPresentation({
      persistedStatus: 'acp_ready',
      response: response({
        parts: [{ kind: 'text', text: 'Half an ans' }],
        stop: { kind: 'cancelled' },
      }),
    });

    expect(presentation).toEqual({
      kind: 'answering',
      markdown: 'Half an ans',
      activity: { label: 'Stopped', busy: false },
    });
  });

  it('settles into final markdown without completion chrome', () => {
    const presentation = deriveMagicChipPresentation({
      persistedStatus: 'booting',
      response: response({
        parts: [{ kind: 'text', text: '**Fixed.**' }],
        stop: { kind: 'end_turn' },
      }),
    });

    expect(presentation).toEqual({ kind: 'settled', markdown: '**Fixed.**' });
  });
});
