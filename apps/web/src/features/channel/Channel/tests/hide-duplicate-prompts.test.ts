import type { FoldedMessage } from '@core/agent-fold/types';
import type { FoldedMessageLookup } from '@queries/channel/folded-messages';
import type { ApiAgentSessionMessageIdentifier } from '@service-storage/generated/schemas/apiAgentSessionMessageIdentifier';
import { describe, expect, it } from 'vitest';
import { duplicatePromptRowIds } from '../hide-duplicate-prompts';

const SESSION = '019fdaa9-1459-75f5-9911-30dd239a9ea8';

function folded(
  turn: number,
  kind: 'user' | 'agent',
  text: string
): FoldedMessage {
  return {
    agentSessionId: SESSION,
    turn,
    author: kind === 'user' ? { kind: 'user' } : { kind: 'agent' },
    parts: [{ kind: 'text', text }],
  };
}

/**
 * Taken from a real session: turn 0 arrived by mentioning the agent elsewhere,
 * so it was never posted here; turns 1 and 2 were typed into the channel.
 */
const FOLD: Record<string, FoldedMessage> = {
  '0:user': folded(
    0,
    'user',
    '<m-user-mention>{"userId":"bot|0"}</m-user-mention> how do channels work'
  ),
  '0:agent': folded(0, 'agent', 'Channels are…'),
  '1:user': folded(
    1,
    'user',
    "woah that's cool is this written in php mostly?"
  ),
  '2:user': folded(2, 'user', 'neato'),
};
const lookup: FoldedMessageLookup = (sessionId, id) =>
  sessionId === SESSION ? FOLD[`${id.turn}:${id.author}`] : undefined;

type Row = {
  id: string;
  agent_session_message: ApiAgentSessionMessageIdentifier | null;
  content: string | null;
};

/** Fixtures name a folded message `"{turn}:{author}"` — it reads better here. */
const placeholder = (key: string): Row => {
  const [turn, author] = key.split(':');
  return {
    id: `row-${key}`,
    agent_session_message: {
      agent_session_id: SESSION,
      turn: Number(turn),
      author: author as 'user' | 'agent',
    },
    content: null,
  };
};

const posted = (content: string): Row => ({
  id: `row-posted-${content}`,
  agent_session_message: null,
  content,
});

/** The rows left after hiding, in order — what the channel renders. */
function visible(rows: Row[], fold: FoldedMessageLookup | undefined): Row[] {
  const hidden = duplicatePromptRowIds(rows, fold);
  return rows.filter((row) => !hidden.has(row.id));
}

describe('duplicatePromptRowIds', () => {
  it('hides a folded prompt the channel already posted', () => {
    const rows = [
      placeholder('1:user'),
      posted("woah that's cool is this written in php mostly?"),
    ];

    expect(visible(rows, lookup)).toEqual([
      posted("woah that's cool is this written in php mostly?"),
    ]);
  });

  it('keeps a prompt with no posted copy — the session opened elsewhere', () => {
    const rows = [placeholder('0:user'), posted('neato')];

    expect(visible(rows, lookup).map((row) => row.id)).toContain('row-0:user');
  });

  it('never hides an agent message, whatever the channel says', () => {
    const rows = [placeholder('0:agent'), posted('Channels are…')];

    expect(visible(rows, lookup)).toHaveLength(2);
  });

  it('hides nothing while the fold has not landed', () => {
    const rows = [placeholder('1:user'), posted('anything')];

    expect(duplicatePromptRowIds(rows, undefined).size).toBe(0);
  });

  it('identifies rows by their own id, not by the message they render', () => {
    // The channel filters a list of row keys, so an id that is not a row id
    // hides nothing — which is exactly how the first attempt at this failed.
    const rows = [placeholder('2:user'), posted('neato')];

    expect([...duplicatePromptRowIds(rows, lookup)]).toEqual(['row-2:user']);
  });

  it('the whole real channel: turn 0 kept, turns 1 and 2 hidden', () => {
    const rows = [
      placeholder('0:user'),
      placeholder('0:agent'),
      posted("woah that's cool is this written in php mostly?"),
      placeholder('1:user'),
      posted('neato'),
      placeholder('2:user'),
    ];

    expect(
      visible(rows, lookup).map((row) =>
        row.agent_session_message
          ? `${row.agent_session_message.turn}:${row.agent_session_message.author}`
          : `posted:${row.content}`
      )
    ).toEqual([
      '0:user',
      '0:agent',
      "posted:woah that's cool is this written in php mostly?",
      'posted:neato',
    ]);
  });
});
