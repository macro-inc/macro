/**
 * The label must track the harness's real state — never claim "Thinking"
 * while a container is still booting, and never keep verbing once the turn
 * has streamed something the transcript shows.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { type ActivityFacts, activityLabel } from './agent-activity';

const message = (
  id: number,
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    turn: id,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as unknown as FoldedMessage;

const prompt = (id: number) =>
  message(id, 'user', [{ kind: 'text', text: 'hi' }]);
const reply = (id: number, stopped: boolean) =>
  message(
    id,
    'agent',
    [{ kind: 'text', text: 'hello' }],
    stopped ? ({ kind: 'end_turn' } as FoldedMessage['stop']) : null
  );
const openReplyWithoutParts = (id: number) => message(id, 'agent', []);
const modelChange = (id: number) =>
  message(id, 'user', [
    {
      kind: 'control',
      control: { kind: 'set_model', model: 'github-copilot/gpt-5.6-terra' },
      outcome: { kind: 'accepted' },
    },
  ]);

const facts = (overrides: Partial<ActivityFacts>): ActivityFacts => ({
  loadFailed: false,
  pending: false,
  resuming: false,
  sending: false,
  working: false,
  status: { kind: 'event', event: 'acp_ready' },
  messages: [],
  ...overrides,
});

describe('activityLabel', () => {
  it('narrates the create, which blocks on the sandbox boot', () => {
    expect(activityLabel(facts({ pending: true }))).toBe('Starting container');
  });

  it('says nothing for a create that failed — the error line shows', () => {
    expect(
      activityLabel(facts({ pending: true, loadFailed: true }))
    ).toBeUndefined();
  });

  it('narrates a resume, over anything the stale transcript says', () => {
    expect(
      activityLabel(
        facts({
          resuming: true,
          sending: true,
          status: { kind: 'disconnected' },
          messages: [prompt(0), reply(0, false)],
        })
      )
    ).toBe('Resuming container');
  });

  it('narrates a container still coming up on a session that never spoke', () => {
    expect(activityLabel(facts({ status: { kind: 'no_messages' } }))).toBe(
      'Starting container'
    );
  });

  it('says nothing on an idle session, empty or settled', () => {
    expect(activityLabel(facts({}))).toBeUndefined();
    expect(
      activityLabel(facts({ messages: [prompt(0), reply(0, true)] }))
    ).toBeUndefined();
  });

  it('thinks while a prompt awaits its reply', () => {
    expect(activityLabel(facts({ working: true, messages: [prompt(0)] }))).toBe(
      'Thinking'
    );
  });

  it('still reports the container when a prompt beat it there', () => {
    expect(
      activityLabel(
        facts({
          working: true,
          status: { kind: 'no_messages' },
          messages: [prompt(0)],
        })
      )
    ).toBe('Starting container');
  });

  it('thinks from the send, before the fold shows the turn', () => {
    expect(
      activityLabel(
        facts({ sending: true, messages: [prompt(0), reply(0, true)] })
      )
    ).toBe('Thinking');
  });

  it('thinks through a turn that has opened but streamed nothing', () => {
    expect(
      activityLabel(
        facts({
          working: true,
          messages: [prompt(0), openReplyWithoutParts(0)],
        })
      )
    ).toBe('Thinking');
  });

  it('yields to the transcript once the turn streams content', () => {
    expect(
      activityLabel(
        facts({ working: true, messages: [prompt(0), reply(0, false)] })
      )
    ).toBeUndefined();
  });

  it('looks past a control to the streaming turn behind it', () => {
    expect(
      activityLabel(
        facts({
          working: true,
          messages: [prompt(0), reply(0, false), modelChange(1)],
        })
      )
    ).toBeUndefined();
  });

  it('says nothing for a dead runtime nothing is waking', () => {
    expect(
      activityLabel(
        facts({
          status: { kind: 'disconnected' },
          messages: [prompt(0), reply(0, false)],
        })
      )
    ).toBeUndefined();
    expect(
      activityLabel(facts({ status: { kind: 'event', event: 'disconnected' } }))
    ).toBeUndefined();
  });

  it('surfaces an event the protocol does not model yet', () => {
    expect(
      activityLabel(
        facts({
          working: true,
          status: { kind: 'event', event: 'worktree_ready' },
          messages: [prompt(0)],
        })
      )
    ).toBe('Worktree ready');
  });
});
