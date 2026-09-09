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

/** The question, in the answer area's place while one is live. */
function askingBody(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-asking]');
}

/** The decisions at the bottom right of the question. */
function decisions(container: HTMLElement) {
  return container.querySelector('[data-magic-chip-decisions]');
}

// The composers are the chat block's real editors over calendar and email
// queries; the chip's job is to mount the right one and wire its sink, so
// each stub exposes the sink through two buttons.
type StubSink = {
  canAct: () => boolean;
  onExecute: (args: unknown) => Promise<boolean>;
  onReject: () => Promise<boolean>;
};
function composerStub(kind: string) {
  return (props: { initialData: unknown; sink: StubSink }) => (
    <div data-testid={`${kind}-composer`} data-can-act={props.sink.canAct()}>
      {/* A widget the area cannot recognize as a control. */}
      <div data-testid="composer-surface" />
      <button
        type="button"
        data-testid="composer-execute"
        onClick={() => void props.sink.onExecute(props.initialData)}
      />
      <button
        type="button"
        data-testid="composer-reject"
        onClick={() => void props.sink.onReject()}
      />
    </div>
  );
}
vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: composerStub('calendar'),
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: composerStub('email'),
}));

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

    expect(answerArea(container)?.className).toMatch(/(^|\s)h-41(\s|$)/);
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

  it('names the persona and its model in the header', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Thinking', busy: true },
        }}
        header={{ agent: 'Cursor Agent', model: 'Claude Opus 5' }}
      />
    ));
    const label = headerLabel(container);
    expect(label?.textContent).toContain('Cursor Agent');
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

    expect(answerArea(container)?.className).toMatch(/(^|\s)h-41(\s|$)/);
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
    expect(area.className).toMatch(/(^|\s)h-41(\s|$)/);
    expect(fade()).toBeTruthy();

    fireEvent.click(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    expect(area.className).not.toMatch(/(^|\s)h-41(\s|$)/);
    expect(area.className).toContain('min-h-41');
    expect(clip()?.className).not.toContain('overflow-hidden');
    expect(fade()).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(area, { key: 'Enter' });
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(area.className).toMatch(/(^|\s)h-41(\s|$)/);
    expect(clip()?.className).toContain('overflow-hidden');
    expect(fade()).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('reads Done in the header once the turn settles', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'All done' }}
        onOpen={onOpen}
      />
    ));

    expect(answerArea(container)?.className).toMatch(/(^|\s)h-41(\s|$)/);
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

/** The text of the decisions row, in order. */
function decisionLabels(container: HTMLElement) {
  return [...(decisions(container)?.querySelectorAll('button') ?? [])].map(
    (button) => button.textContent?.trim()
  );
}

describe('MagicChipView reviewing a tool draft', () => {
  it('mounts the draft in its composer with Dismiss and the session on the row', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true, 'Setting that up.')}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    // The question takes the area in the passage's place.
    const area = answerArea(view.container)!;
    expect(area.className).toMatch(/(^|\s)h-41(\s|$)/);
    expect(view.queryByTestId('chip-markdown')).toBeNull();
    const body = askingBody(view.container);
    expect(area.contains(body)).toBe(true);
    expect(body?.textContent).toContain('Create calendar event?');
    // The tool's own composer, editable in place, with Create as its own.
    const composer = view.getByTestId('calendar-composer');
    expect(body?.contains(composer)).toBe(true);
    expect(composer.dataset.canAct).toBe('true');

    expect(decisionLabels(view.container)).toEqual([
      'Dismiss',
      'Open in session',
    ]);
    expect(header(view.container)?.textContent).toContain('Waiting for you');
    expect(
      headerLabel(view.container)?.getAttribute('data-message-reply-preview')
    ).toBe('Waiting for you · Create calendar event?');

    fireEvent.click(view.getByTestId('composer-execute'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(draft) },
    });
    fireEvent.click(view.getByTestId('composer-reject'));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(view.getByText('Dismiss'));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(view.getByText('Open in session'));
    fireEvent.click(view.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('expands the question in place, and its buttons do not toggle it', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true)}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    const area = answerArea(view.container)!;
    const clip = () => view.container.querySelector('[data-magic-chip-clip]');
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(clip()?.className).toContain('overflow-hidden');
    expect(view.container.querySelector('[data-magic-chip-fade]')).toBeTruthy();

    fireEvent.click(view.getByText('Dismiss'));
    fireEvent.click(view.getByTestId('composer-execute'));
    fireEvent.click(view.getByTestId('composer-surface'));
    expect(area.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    expect(area.className).not.toMatch(/(^|\s)h-41(\s|$)/);
    expect(area.className).toContain('min-h-41');
    expect(clip()?.className).not.toContain('overflow-hidden');
    expect(view.container.querySelector('[data-magic-chip-fade]')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a viewer who is not the owner sees the draft read-only and who is being waited on', () => {
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
    // The composer is there to read, but cannot act for a viewer.
    expect(view.getByTestId('calendar-composer').dataset.canAct).toBe('false');
    fireEvent.click(view.getByTestId('composer-execute'));
    expect(decisions(view.container)).toBeNull();
    fireEvent.click(view.getByLabelText('Open in session'));
    expect(onOpen).toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('holds the buttons while an answer is on the wire', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={asking(true)}
        answer={{ answering: true, respond }}
      />
    ));
    expect(view.getByTestId('calendar-composer').dataset.canAct).toBe('false');
    fireEvent.click(view.getByTestId('composer-execute'));
    fireEvent.click(view.getByText('Dismiss'));
    expect(respond).not.toHaveBeenCalled();
  });

  it('keeps the expanded answer while a review takes the area and gives it back', () => {
    // Answering unmounts the question while the composer's effects wind
    // down; nothing may read a `<Show>` accessor that has gone stale.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    expect(view.getByTestId('calendar-composer')).toBeTruthy();
    expect(view.queryByTestId('chip-markdown')).toBeNull();
    expect(answerArea(view.container)).toBe(area);

    fireEvent.click(view.getByText('Dismiss'));
    setPresentation({ kind: 'settled', markdown: 'Created the event.' });
    expect(view.queryByTestId('calendar-composer')).toBeNull();
    expect(askingBody(view.container)).toBeNull();
    expect(view.getByText('Created the event.')).toBeTruthy();
    expect(header(view.container)?.textContent).toContain('Done');
    expect(answerArea(view.container)).toBe(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('stale'))
    ).toBe(false);
    warn.mockRestore();
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
  it('offers the choices in the area and Decline, Submit, the session on the row', () => {
    const view = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion(colourForm)}
        answer={{ answering: false, respond }}
        onOpen={onOpen}
      />
    ));
    const area = answerArea(view.container)!;
    expect(area.className).toMatch(/(^|\s)h-41(\s|$)/);
    const body = askingBody(view.container);
    expect(body?.contains(view.getByRole('radio', { name: 'Red' }))).toBe(true);
    expect(body?.textContent).toContain("What's the best colour?");
    expect(decisionLabels(view.container)).toEqual([
      'Decline',
      'Submit',
      'Open in session',
    ]);
    expect(view.queryByText('Cancel')).toBeNull();
    expect(
      view.container.querySelector('[data-magic-chip-pending]')
    ).toBeNull();

    // A required question refuses an empty submit.
    fireEvent.click(view.getByText('Submit'));
    expect(respond).not.toHaveBeenCalled();
    expect(view.getByText('Required')).toBeTruthy();

    // Picking a choice is the choice's, not a toggle of the area.
    fireEvent.click(view.getByRole('radio', { name: 'Blue' }));
    expect(area.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view.getByText('Submit'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { question_0: 'Blue' },
    });

    fireEvent.click(view.getByText('Decline'));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    fireEvent.click(view.getByText('Open in session'));
    expect(onOpen).toHaveBeenCalledOnce();
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
    expect(decisions(view.container)).toBeNull();
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
