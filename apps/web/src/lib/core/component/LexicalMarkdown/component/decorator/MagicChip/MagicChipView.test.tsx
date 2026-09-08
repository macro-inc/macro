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

// The chip answers a form with the real `ElicitationForm`; the rest of the
// block-agent ui barrel reaches the composer, comments, and a socket.
vi.mock('@app/features/block-agent/ui', async () => ({
  ElicitationForm: (
    await import('@app/features/block-agent/ui/ElicitationForm')
  ).ElicitationForm,
}));

afterEach(cleanup);

const LONG_PATH =
  '/home/ubuntu/.cursor/projects/workspace/terminals/261831.txt'.repeat(8);

function answerArea(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-answer]');
}

function header(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-header]');
}

/** The header's label, which opens the session and carries the preview. */
function headerLabel(container: HTMLElement) {
  return header(container)?.querySelector('button');
}

/** The pane a form or URL question's fields live in, beside the answer. */
function pane(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-pane]');
}

const respond = vi.fn<(answer: ElicitationAnswer) => Promise<boolean>>();
const onOpen = vi.fn();

beforeEach(() => {
  respond.mockReset();
  respond.mockResolvedValue(true);
  onOpen.mockReset();
});

describe('MagicChipView', () => {
  it('reserves the answer height and reads the activity in the header while working', () => {
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

    expect(answerArea(container)?.className).toContain('h-22');
    expect(container.querySelector('[data-testid="chip-markdown"]')).toBeNull();
    expect(container.querySelector('[data-magic-chip-pending]')).toBeTruthy();

    const label = headerLabel(container);
    expect(label?.textContent).toContain('Booting agent');
    expect(label?.getAttribute('data-message-reply-preview')).toBe(
      'Booting agent'
    );

    // Nothing to expand yet, so the answer area leads to the session too.
    expect(answerArea(container)?.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(answerArea(container)!);
    fireEvent.click(label!);
    fireEvent.click(screen.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('names the bot and its model in the header', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Thinking', busy: true },
        }}
        header={{ agent: 'cursor', model: 'Claude Opus 5' }}
      />
    ));
    const label = headerLabel(container);
    expect(label?.textContent).toContain('@cursor');
    expect(label?.textContent).toContain('Claude Opus 5');
    expect(label?.textContent).toContain('Thinking');
  });

  it('keeps the same answer height once the answer streams in', () => {
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
    // With prose in the area, the reply previews it, not the header.
    const preview = container.querySelector('[data-message-reply-preview]');
    expect(preview?.textContent).toBe('Hello from the agent');
    expect(
      headerLabel(container)?.getAttribute('data-message-reply-preview')
    ).toBeNull();

    expect(headerLabel(container)?.textContent).toContain('Writing response');
    fireEvent.click(screen.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('expands the answer in place on click and collapses again', () => {
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

  it('reads Done in the header once the turn settles', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'All done' }}
        onOpen={onOpen}
      />
    ));

    expect(answerArea(container)?.className).toContain('h-22');
    expect(headerLabel(container)?.textContent).toContain('Done');
    expect(headerLabel(container)?.textContent).not.toContain('Open session');
    fireEvent.click(headerLabel(container)!);
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

describe('MagicChipView reviewing a tool draft', () => {
  it('offers only the go-ahead, in the header, and leaves the rest to the session', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true, 'Setting that up.')}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(view.getByTestId('chip-markdown').textContent).toBe(
      'Setting that up.'
    );
    expect(answerArea(view.container)?.className).toContain('h-22');
    expect(pane(view.container)).toBeNull();

    const top = header(view.container);
    expect(top?.textContent).toContain('Waiting for you');
    expect(top?.contains(view.getByText('Create event'))).toBe(true);
    expect(view.queryByText('Cancel')).toBeNull();
    expect(view.queryByText('Edit in session')).toBeNull();
    expect(
      headerLabel(view.container)?.getAttribute('data-message-reply-preview')
    ).toBeNull();

    fireEvent.click(view.getByText('Create event'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(draft) },
    });
    fireEvent.click(view.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows nothing in the answer area while the agent has said nothing', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true)}
        answer={{ answering: false, respond }}
      />
    ));
    expect(answerArea(view.container)?.className).toContain('h-22');
    expect(answerArea(view.container)?.className).not.toContain('hidden');
    expect(
      view.container.querySelector('[data-magic-chip-pending]')
    ).toBeNull();
    expect(view.queryByTestId('chip-markdown')).toBeNull();
    expect(
      headerLabel(view.container)?.getAttribute('data-message-reply-preview')
    ).toBe('Waiting for you · Create calendar event?');
  });

  it('a viewer who is not the owner sees who is being waited on and can only open the session', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(false)}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(header(view.container)?.textContent).toContain(
      'Waiting for Alice Owner'
    );
    expect(view.queryByText('Create event')).toBeNull();
    fireEvent.click(view.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('holds the button while an answer is on the wire', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true)}
        answer={{ answering: true, respond }}
      />
    ));
    fireEvent.click(view.getByText('Create event'));
    expect(respond).not.toHaveBeenCalled();
  });

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
    expect(header(view.container)?.textContent).toContain('Done');
    expect(answerArea(view.container)).toBe(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
  });
});

const colourForm = {
  kind: 'form' as const,
  schema: {
    title: null,
    description: null,
    required: ['question_0'],
    properties: [
      {
        name: 'question_0',
        title: 'Best colour',
        description: null,
        schema: {
          type: 'string' as const,
          minLength: null,
          maxLength: null,
          pattern: null,
          format: null,
          default: null,
          options: [
            { value: 'Red', title: 'Red', description: null },
            { value: 'Blue', title: 'Blue', description: null },
          ],
          customField: 'question_0_custom',
        },
      },
    ],
  },
};

function askingQuestion(
  request: Extract<
    MagicChipPresentation,
    { kind: 'asking' }
  >['asking']['question']['request'],
  options: { canAnswer?: boolean; requestId?: number; markdown?: string } = {}
): MagicChipPresentation {
  return {
    kind: 'asking',
    markdown: options.markdown ?? '',
    asking: {
      question: {
        requestId: options.requestId ?? 0,
        turn: 0,
        toolCall: null,
        message: "What's the best colour?",
        request,
      },
      canAnswer: options.canAnswer ?? true,
      ownerName: 'Alice Owner',
    },
  };
}

describe('MagicChipView asking a form', () => {
  it('offers the choices in the pane and the decisions in the header', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion(colourForm)}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(
      pane(view.container)?.contains(view.getByRole('radio', { name: 'Red' }))
    ).toBe(true);
    expect(pane(view.container)?.textContent).toContain(
      "What's the best colour?"
    );
    expect(header(view.container)?.contains(view.getByText('Submit'))).toBe(
      true
    );
    // The header is short of room, so Cancel stays in the session.
    expect(view.queryByText('Cancel')).toBeNull();

    // A required question refuses an empty submit.
    fireEvent.click(view.getByText('Submit'));
    expect(respond).not.toHaveBeenCalled();
    expect(view.getByText('Required')).toBeTruthy();

    fireEvent.click(view.getByRole('radio', { name: 'Blue' }));
    fireEvent.click(view.getByText('Submit'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { question_0: 'Blue' },
    });

    fireEvent.click(view.getByText('Decline'));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(view.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('gives the question the whole card while the agent has said nothing, and the right side once it has', () => {
    const [presentation, setPresentation] = createSignal(
      askingQuestion(colourForm)
    );
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={presentation()}
        answer={{ answering: false, respond }}
      />
    ));
    expect(answerArea(view.container)?.className).toContain('hidden');
    expect(
      view.container.querySelector('[data-magic-chip-pending]')
    ).toBeNull();
    expect(pane(view.container)?.className).toContain('flex-1');
    expect(pane(view.container)?.className).not.toContain('border-l');
    // The pane stretches to the chip and scrolls inside it.
    expect(pane(view.container)?.firstElementChild?.className).toContain(
      'absolute inset-0'
    );
    expect(pane(view.container)?.firstElementChild?.className).toContain(
      'overflow-y-auto'
    );

    setPresentation(
      askingQuestion(colourForm, { markdown: 'Let me ask you something.' })
    );
    expect(answerArea(view.container)?.className).not.toContain('hidden');
    expect(answerArea(view.container)?.className).toContain('h-22');
    expect(pane(view.container)?.className).toContain('border-l');
    expect(pane(view.container)?.className).not.toContain('flex-1');
  });

  it('types a custom answer and sends it under the custom key', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion(colourForm)}
        answer={{ answering: false, respond }}
      />
    ));
    fireEvent.input(view.getByPlaceholderText('Type your own answer'), {
      target: { value: 'teal' },
    });
    fireEvent.click(view.getByText('Submit'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { question_0_custom: 'teal' },
    });
  });

  it('keeps what was typed across a refresh of the same question, and starts clean for a new one', () => {
    const [presentation, setPresentation] = createSignal(
      askingQuestion(colourForm)
    );
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={presentation()}
        answer={{ answering: false, respond }}
      />
    ));
    fireEvent.click(view.getByRole('radio', { name: 'Blue' }));

    // The same request, pushed again by a metadata refresh.
    setPresentation(askingQuestion(colourForm));
    expect(
      view.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')
    ).toBe('true');

    setPresentation(askingQuestion(colourForm, { requestId: 1 }));
    expect(
      view.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')
    ).toBe('false');
  });

  it('a viewer who is not the owner sees the choices locked and no decisions', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion(colourForm, { canAnswer: false })}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    expect(header(view.container)?.textContent).toContain(
      'Waiting for Alice Owner'
    );
    const red = view.getByRole('radio', { name: 'Red' }) as HTMLButtonElement;
    expect(red.disabled).toBe(true);
    expect(view.queryByText('Submit')).toBeNull();
    expect(view.queryByText('Decline')).toBeNull();
  });

  it('a url request shows the host and opens only after consent', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion({
          kind: 'url',
          elicitationId: 'gh-1',
          url: 'https://agent.example.com/connect?e=gh-1',
        })}
        answer={{ answering: false, respond }}
      />
    ));
    expect(view.getByText('agent.example.com')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Open'));
    await Promise.resolve();
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({ action: 'accept' });
    expect(open).toHaveBeenCalledWith(
      'https://agent.example.com/connect?e=gh-1',
      '_blank',
      'noopener,noreferrer'
    );
    open.mockRestore();
  });

  it('a request this client cannot display can still be declined', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion({
          kind: 'unrecognized',
          mode: 'hologram',
          raw: {},
        })}
        answer={{ answering: false, respond }}
      />
    ));
    expect(view.getByText(/cannot display a "hologram" request/)).toBeTruthy();
    fireEvent.click(view.getByText('Decline'));
    expect(respond).toHaveBeenCalledWith({ action: 'decline' });
  });
});
