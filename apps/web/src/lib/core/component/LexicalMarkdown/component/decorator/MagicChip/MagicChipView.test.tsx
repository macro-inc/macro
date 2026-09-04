/**
 * @vitest-environment jsdom
 *
 * The chip's question card: a user tool's draft summarized, Create sending
 * the draft whole, Cancel declining, editing deferred to the session, and
 * nothing offered to a viewer who is not the owner.
 */

import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The answer body walks a Lexical tree; the card under test is beside it.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <div data-testid="answer">{props.markdown}</div>
    ),
    StaticMarkdownContext: (props: { children?: JSX.Element }) =>
      props.children,
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({ channelTheme: {} }));
vi.mock('@app/features/block-agent/component/parts/UserToolCall', () => ({
  EventDraft: (props: { event: { title: string } }) => (
    <div data-testid="event-draft">{props.event.title}</div>
  ),
  EmailDraft: (props: { email: { subject: string } }) => (
    <div data-testid="email-draft">{props.email.subject}</div>
  ),
}));

import { MagicChipView } from './MagicChipView';
import type { MagicChipPresentation } from './presentation';

const draft = {
  title: 'Q3 sync',
  time: {
    kind: 'timed',
    startsAt: '2026-08-20T17:00:00Z',
    endsAt: '2026-08-20T17:30:00Z',
    timeZone: 'UTC',
  },
};

function asking(canAnswer: boolean, markdown = ''): MagicChipPresentation {
  return {
    kind: 'asking',
    markdown,
    asking: {
      question: {
        requestId: 9,
        turn: 0,
        toolCall: 'toolu_evt',
        message: 'Create calendar event?',
        request: {
          kind: 'user_tool',
          tool: 'CreateCalendarEvent',
          draft,
          schema: {
            title: null,
            description: null,
            properties: [],
            required: [],
          },
        },
      },
      canAnswer,
      ownerName: 'Alice Owner',
    },
  };
}

const respond = vi.fn<(answer: ElicitationAnswer) => Promise<boolean>>();
const onOpen = vi.fn();

beforeEach(() => {
  respond.mockReset();
  respond.mockResolvedValue(true);
  onOpen.mockReset();
});

describe('MagicChipView asking', () => {
  it('summarizes the draft and sends it whole on Create, declines on Cancel', () => {
    const { getByTestId, getByText } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true, 'Setting that up.')}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(getByTestId('answer').textContent).toBe('Setting that up.');
    expect(getByTestId('event-draft').textContent).toBe('Q3 sync');
    expect(getByText('Waiting for you')).not.toBeNull();

    fireEvent.click(getByText('Create event'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(draft) },
    });
    fireEvent.click(getByText('Cancel'));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(getByText('Edit in session'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('a viewer who is not the owner sees who is being waited on and can only open the session', () => {
    const { queryByText, getByText } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(false)}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(getByText('Waiting for Alice Owner')).not.toBeNull();
    expect(queryByText('Create event')).toBeNull();
    expect(queryByText('Cancel')).toBeNull();
    fireEvent.click(getByText('Open session'));
    expect(onOpen).toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('holds the buttons while an answer is on the wire', () => {
    const { getByText } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true)}
        answer={{ answering: true, respond }}
      />
    ));
    fireEvent.click(getByText('Create event'));
    expect(respond).not.toHaveBeenCalled();
  });
});
