import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  deriveMagicChipPresentation,
  type MagicChipPresentationInput,
} from './presentation';

function present(
  input: Omit<MagicChipPresentationInput, 'foldReady'> & {
    foldReady?: boolean;
  }
) {
  return deriveMagicChipPresentation({ foldReady: true, ...input });
}

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
  it('stays on loading until the fold is ready', () => {
    expect(present({ foldReady: false, persistedStatus: 'booting' })).toEqual({
      kind: 'loading',
    });
  });

  it('renders a live boot from persisted state once the fold is ready', () => {
    expect(present({ persistedStatus: 'booting' })).toMatchObject({
      kind: 'working',
      activity: { label: 'Booting agent', busy: true },
    });
  });

  it('shows thought activity before answer text exists', () => {
    expect(
      present({
        persistedStatus: 'booting',
        response: response(),
      })
    ).toEqual({
      kind: 'working',
      activity: {
        icon: 'think',
        label: 'Thinking',
        detail: 'Inspecting the repository',
        busy: true,
      },
    });
  });

  it('prefers a running tool over a later completed tool', () => {
    const presentation = present({
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
      const presentation = present({
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
    const presentation = present({
      persistedStatus: 'acp_ready',
      response: response({ parts: [{ kind: 'text', text: 'Looking at t' }] }),
    });

    expect(presentation).toEqual({
      kind: 'answering',
      markdown: 'Looking at t',
      activity: { icon: 'write', label: 'Writing response', busy: false },
    });
  });

  it('shows only the latest agent message when the turn has several', () => {
    const presentation = present({
      persistedStatus: 'acp_ready',
      response: response({
        parts: [
          { kind: 'text', text: 'Let me check the tests.' },
          {
            kind: 'tool_use',
            rawInput: null,
            rawOutput: null,
            id: 'done',
            label: 'Terminal',
            status: 'completed',
            detail: {
              kind: 'terminal',
              command: 'cargo test',
              output: null,
              exitCode: 0,
            },
          },
          { kind: 'text', text: 'All green.' },
        ],
        stop: { kind: 'end_turn' },
      }),
    });

    expect(presentation).toEqual({ kind: 'settled', markdown: 'All green.' });
  });

  it('keeps the answer visible while a tool runs mid-turn', () => {
    // Prose, then a tool call: the text stays and the activity says what the
    // agent moved on to, rather than the answer vanishing until it resumes.
    const presentation = present({
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
      activity: {
        icon: 'terminal',
        label: 'Running command',
        detail: 'cargo test',
        busy: true,
      },
    });
  });

  it('keeps partial prose when a turn is cancelled', () => {
    const presentation = present({
      persistedStatus: 'acp_ready',
      response: response({
        parts: [{ kind: 'text', text: 'Half an ans' }],
        stop: { kind: 'cancelled' },
      }),
    });

    expect(presentation).toEqual({
      kind: 'answering',
      markdown: 'Half an ans',
      activity: { icon: 'stop', label: 'Stopped', busy: false },
    });
  });

  it('settles into final markdown without completion chrome', () => {
    const presentation = present({
      persistedStatus: 'booting',
      response: response({
        parts: [{ kind: 'text', text: '**Fixed.**' }],
        stop: { kind: 'end_turn' },
      }),
    });

    expect(presentation).toEqual({ kind: 'settled', markdown: '**Fixed.**' });
  });
});
