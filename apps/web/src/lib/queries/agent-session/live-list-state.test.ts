import type {
  FoldedMessage,
  MessagePart,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { deriveAgentSessionLiveState } from './live-list-state';

const metadata = (
  overrides: Partial<SessionMetadata> = {}
): SessionMetadata => ({
  model: null,
  supportedModels: [],
  title: null,
  availableCommands: [],
  status: 'acp_ready',
  ...overrides,
});

const message = (
  turn: number,
  author: 'user' | 'agent',
  overrides: Partial<FoldedMessage> = {}
): FoldedMessage => ({
  agentSessionId: 's-1',
  turn,
  author:
    author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
  requestId: null,
  parts: [{ kind: 'text', text: 'hi' }],
  stop: author === 'agent' ? { kind: 'end_turn' } : null,
  ...overrides,
});

const pendingPermission: MessagePart = {
  kind: 'permission',
  toolCall: 'tool-1',
  options: [],
  outcome: { kind: 'pending' },
};

describe('deriveAgentSessionLiveState', () => {
  it('reads title and status off the metadata', () => {
    const state = deriveAgentSessionLiveState(
      [],
      metadata({ title: 'Fix the tests', status: 'acp_ready' })
    );
    expect(state.title).toBe('Fix the tests');
    expect(state.statusEvent).toBe('acp_ready');
    expect(state.working).toBe(false);
  });

  it('is working while the newest turn is unanswered or unfinished', () => {
    // A prompt with no reply yet.
    expect(
      deriveAgentSessionLiveState([message(0, 'user')], metadata()).working
    ).toBe(true);
    // A reply still streaming (no stop reason).
    expect(
      deriveAgentSessionLiveState(
        [message(0, 'user'), message(0, 'agent', { stop: null })],
        metadata()
      ).working
    ).toBe(true);
    // The turn finished.
    expect(
      deriveAgentSessionLiveState(
        [message(0, 'user'), message(0, 'agent')],
        metadata()
      ).working
    ).toBe(false);
  });

  it('skips controls when finding the turn that says working', () => {
    // A model change after a finished turn is not a turn in flight.
    const control = message(1, 'user', {
      parts: [
        {
          kind: 'control',
          control: { kind: 'set_model', model: 'claude-opus-5' },
          outcome: { kind: 'accepted' },
        },
      ],
    });
    expect(
      deriveAgentSessionLiveState(
        [message(0, 'user'), message(0, 'agent'), control],
        metadata()
      ).working
    ).toBe(false);
  });

  it('orders messages before reading the tail, whatever order they arrive', () => {
    expect(
      deriveAgentSessionLiveState(
        [message(1, 'user'), message(0, 'agent'), message(0, 'user')],
        metadata()
      ).working
    ).toBe(true);
  });

  it('counts outstanding permission requests', () => {
    const asking = message(0, 'agent', {
      stop: null,
      parts: [pendingPermission, pendingPermission],
    });
    const state = deriveAgentSessionLiveState(
      [message(0, 'user'), asking],
      metadata()
    );
    expect(state.pendingPermissionCount).toBe(2);
    expect(state.working).toBe(true);
  });

  it('settles everything once the session disconnects', () => {
    const asking = message(0, 'agent', {
      stop: null,
      parts: [pendingPermission],
    });
    const state = deriveAgentSessionLiveState(
      [message(0, 'user'), asking],
      metadata({ status: 'disconnected' })
    );
    // The unanswered turn will never finish and nobody can answer the
    // permission request — neither should keep pulling attention.
    expect(state.working).toBe(false);
    expect(state.pendingPermissionCount).toBe(0);
  });
});
