/** @vitest-environment jsdom */
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';
import type { MagicChipPresentation } from './presentation';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: (props: { markdown: string }) => (
      <div data-testid="chip-markdown">{props.markdown}</div>
    ),
  })
);

vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  channelTheme: {},
}));

afterEach(cleanup);

const LONG_PATH =
  '/home/ubuntu/.cursor/projects/workspace/terminals/261831.txt'.repeat(8);

function answerArea(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-answer]');
}

describe('MagicChipView', () => {
  it('reserves the answer height and shows the activity row while working', () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Booting agent', busy: true },
        }}
        onOpen={onOpen}
      />
    ));

    const card = container.querySelector('[data-magic-chip-preview]');
    expect(card?.className).toContain('rounded-lg');
    expect(card?.className).not.toContain('border-accent');

    expect(answerArea(container)?.className).toContain('h-22');
    expect(container.querySelector('[data-testid="chip-markdown"]')).toBeNull();
    expect(container.querySelector('[data-magic-chip-pending]')).toBeTruthy();
    expect(container.querySelector('.bg-skeleton')).toBeNull();

    const footer = card?.querySelector('button');
    expect(footer?.textContent).toContain('Booting agent');
    expect(footer?.getAttribute('data-message-reply-preview')).toBe(
      'Booting agent'
    );

    // Nothing to expand yet, so the answer area leads to the session too.
    expect(answerArea(container)?.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(answerArea(container)!);
    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps the same answer height once the answer streams in', () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'answering',
          markdown: 'Hello from the agent',
          activity: { label: 'Writing response', busy: false },
        }}
        onOpen={onOpen}
      />
    ));

    expect(answerArea(container)?.className).toContain('h-22');
    expect(container.querySelector('[data-magic-chip-pending]')).toBeNull();

    const clip = container.querySelector('[data-magic-chip-clip]');
    expect(clip?.className).toContain('overflow-hidden');
    const preview = container.querySelector('[data-message-reply-preview]');
    expect(preview?.textContent).toBe('Hello from the agent');

    const footer = container.querySelector('[data-magic-chip-preview] button');
    expect(footer?.textContent).toContain('Writing response');
    expect(footer?.textContent).not.toContain('Open session');

    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('expands the answer in place on click and collapses again', () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'All done' }}
        onOpen={onOpen}
      />
    ));

    const area = answerArea(container)!;
    const clip = () => container.querySelector('[data-magic-chip-clip]');
    const fade = () => container.querySelector('[data-magic-chip-fade]');
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(area.className).toContain('h-22');
    expect(fade()).toBeTruthy();
    expect(area.textContent).toContain('Show more');

    fireEvent.click(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    expect(area.className).not.toContain('h-22');
    expect(clip()?.className).not.toContain('overflow-hidden');
    expect(fade()).toBeNull();
    expect(area.textContent).toContain('Show less');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(area, { key: 'Enter' });
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(area.className).toContain('h-22');
    expect(clip()?.className).toContain('overflow-hidden');
    expect(fade()).toBeTruthy();
    expect(area.textContent).toContain('Show more');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps the disclosure hint out of the reply preview text', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'All done' }}
      />
    ));

    fireEvent.click(answerArea(container)!);
    expect(answerArea(container)?.textContent).toContain('Show less');
    expect(
      container.querySelector('[data-message-reply-preview]')?.textContent
    ).toBe('All done');
  });

  it('labels the settled footer Open session', () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'All done' }}
        onOpen={onOpen}
      />
    ));

    expect(answerArea(container)?.className).toContain('h-22');
    const footer = container.querySelector('[data-magic-chip-preview] button');
    expect(footer?.textContent).toContain('Open session');
    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps a long activity detail inside the message column', () => {
    const { container } = render(() => (
      <div style={{ width: '320px' }}>
        <MagicChipView
          agentSessionId="session-1"
          presentation={{
            kind: 'working',
            activity: { label: 'Thinking', detail: LONG_PATH, busy: true },
          }}
        />
      </div>
    ));

    const card = container.querySelector('[data-magic-chip="session-1"]');
    expect(card?.className).toContain('min-w-0');
    expect(card?.className).toContain('max-w-full');
    expect(card?.className).toContain('overflow-hidden');
    expect(screen.getByText('Thinking')).toBeTruthy();
    expect(screen.getByText(LONG_PATH).className).toContain('truncate');
  });
});

vi.mock('@app/features/block-agent/component/parts/UserToolCall', () => ({
  EventDraft: (props: { event: { title: string } }) => (
    <div data-testid="event-draft">{props.event.title}</div>
  ),
  EmailDraft: (props: { email: { subject: string } }) => (
    <div data-testid="email-draft">{props.email.subject}</div>
  ),
}));

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
    expect(getByTestId('chip-markdown').textContent).toBe('Setting that up.');
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

describe('MagicChipView review transition', () => {
  it('keeps the expanded answer while a review appears and the agent continues', () => {
    const [presentation, setPresentation] = createSignal<MagicChipPresentation>(
      {
        kind: 'answering',
        markdown: 'Setting that up.',
        activity: { label: 'Writing response', busy: false },
      }
    );
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={presentation()}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    const area = answerArea(view.container)!;
    fireEvent.click(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');

    setPresentation(asking(true, 'Setting that up.'));
    expect(view.getByText('Create event')).toBeTruthy();
    expect(answerArea(view.container)).toBe(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');

    setPresentation({ kind: 'settled', markdown: 'Created the event.' });
    expect(view.queryByText('Create event')).toBeNull();
    expect(view.getByText('Created the event.')).toBeTruthy();
    expect(answerArea(view.container)).toBe(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(view.getByText('Open session'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
