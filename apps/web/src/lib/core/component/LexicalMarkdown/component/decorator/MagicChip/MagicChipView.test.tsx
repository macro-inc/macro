/** @vitest-environment jsdom */
import type {
  ElicitationSchema,
  PendingElicitation,
} from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
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

vi.mock('@core/component/LexicalMarkdown/theme', () => ({ channelTheme: {} }));

// The PR link resolves its entity over the network; the view only places it.
vi.mock('./MagicChipPullRequest', () => ({
  MagicChipPullRequest: (props: { url: string }) => (
    <a data-testid="chip-pull-request" href={props.url}>
      {props.url}
    </a>
  ),
}));

afterEach(cleanup);

const LONG_PATH =
  '/home/ubuntu/.cursor/projects/workspace/terminals/261831.txt'.repeat(8);

const statusRow = (container: HTMLElement) =>
  container.querySelector('[data-magic-chip-header]');
const outputRow = (container: HTMLElement) =>
  container.querySelector('[data-magic-chip-answer]');
const line = (container: HTMLElement) =>
  container.querySelector('[data-magic-chip-line]');
const dot = (container: HTMLElement) =>
  container.querySelector('[data-magic-chip-dot]');
const card = (container: HTMLElement) =>
  container.querySelector('[data-magic-chip]');

let onOpen: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  onOpen = vi.fn<() => void>();
});

/** A question the agent has stopped on, as the fold reports it. */
function askingQuestion(message: string): MagicChipPresentation {
  const schema: ElicitationSchema = {
    title: 'Confirm',
    description: null,
    required: [],
    properties: [],
  };
  const request: PendingElicitation & { kind: 'elicitation' } = {
    kind: 'elicitation',
    requestId: 0,
    turn: 1,
    toolCall: null,
    message,
    request: { kind: 'form', schema },
  };
  return {
    kind: 'asking',
    markdown: 'Prose written before the question.',
    asking: { request, answering: false, canAnswer: true },
  };
}

describe('MagicChipView status row', () => {
  it('reads the activity with its detail set in monospace', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: {
            label: 'Running command',
            detail: 'cargo test -p agent_fold',
            busy: true,
          },
        }}
        onOpen={onOpen}
      />
    ));

    const row = statusRow(container)!;
    expect(row.textContent).toContain('Running command');
    expect(row.textContent).toContain('cargo test -p agent_fold');
    expect(row.querySelector('.font-mono')?.textContent).toBe(
      'cargo test -p agent_fold'
    );
    // Busy shimmers the label and pulses the dot.
    expect(row.querySelector('.magic-chip-shimmer')).toBeTruthy();
    expect(dot(container)?.className).toContain('magic-chip-dot');
  });

  it('opens the session from View session', () => {
    render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Done.' }}
        onOpen={onOpen}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /View session/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps a long activity detail inside the card', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Reading files', detail: LONG_PATH, busy: true },
        }}
      />
    ));
    const detail = statusRow(container)?.querySelector('.font-mono');
    expect(detail?.className).toContain('truncate');
    expect(detail?.className).toContain('min-w-0');
    expect(detail?.getAttribute('title')).toBe(LONG_PATH);
  });

  it('places the pull request once the session has one', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Done.' }}
        header={{ pullRequestUrl: 'https://github.com/macro-inc/macro/pull/1' }}
      />
    ));
    // Beside the prose, with room of its own, not squeezed into the status row.
    expect(
      outputRow(container)?.querySelector('[data-testid="chip-pull-request"]')
    ).toBeTruthy();
    expect(
      statusRow(container)?.querySelector('[data-testid="chip-pull-request"]')
    ).toBeNull();
  });

  it('names the persona at the head of the status row', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Booting agent', busy: true },
        }}
        header={{ agent: 'Cursor Agent', model: 'Claude Opus 5' }}
      />
    ));
    const row = statusRow(container);
    expect(row?.querySelector('[data-magic-chip-agent]')?.textContent).toBe(
      'Cursor Agent'
    );
    expect(row?.textContent).toContain('Booting agent');
    // The model is the persona's tooltip, never status-row chrome.
    expect(row?.textContent).not.toContain('Claude Opus 5');
    expect(
      row
        ?.querySelector('[data-message-reply-preview]')
        ?.getAttribute('data-message-reply-preview')
    ).toBe('Cursor Agent · Booting agent');
  });

  it('marks the dot done once the turn settles and asking while it waits', () => {
    const settled = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Done.' }}
      />
    ));
    expect(dot(settled.container)?.getAttribute('data-magic-chip-dot')).toBe(
      'done'
    );
    cleanup();

    const asking = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion('Send this email?')}
      />
    ));
    expect(dot(asking.container)?.getAttribute('data-magic-chip-dot')).toBe(
      'asking'
    );
  });
});

describe('MagicChipView output row', () => {
  it('says nothing is written yet, and the row leads to the session', () => {
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

    expect(line(container)?.textContent).toBe('Nothing written yet');
    // The status row carries the preview while there is no prose.
    expect(
      statusRow(container)
        ?.querySelector('[data-message-reply-preview]')
        ?.getAttribute('data-message-reply-preview')
    ).toBe('Booting agent');

    fireEvent.click(outputRow(container)!);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('flattens the passage onto one line', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'settled',
          markdown:
            '## Fixed\n\n- The **batch** fold now\n  buffers `turn_ended`.',
        }}
      />
    ));
    expect(line(container)?.textContent).toBe(
      'Fixed The batch fold now buffers turn_ended.'
    );
    expect(line(container)?.className).toContain('truncate');
  });

  it('is one control that opens the session, from the row or the card', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'The whole answer.' }}
        header={{ agent: 'Cursor Agent', model: 'Claude Opus 5' }}
        onOpen={onOpen}
      />
    ));

    // Nothing to expand: the passage whole is read in the session.
    expect(container.querySelector('[data-magic-chip-drawer]')).toBeNull();
    expect(container.querySelector('[data-magic-chip-caret]')).toBeNull();
    expect(statusRow(container)?.textContent).toContain('Cursor Agent');
    expect(statusRow(container)?.textContent).not.toContain('Claude Opus 5');

    fireEvent.click(outputRow(container)!);
    fireEvent.click(card(container)!);
    fireEvent.click(screen.getByRole('button', { name: 'View session' }));
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('opens the session from the keyboard', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{ kind: 'settled', markdown: 'Done.' }}
        onOpen={onOpen}
      />
    ));
    fireEvent.keyDown(card(container)!, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('MagicChipView while the agent is asking', () => {
  it('puts the question on the line and sends the reader to the session', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={askingQuestion('Send this email to Eric?')}
        onOpen={onOpen}
      />
    ));

    expect(statusRow(container)?.textContent).toContain('Waiting for you');
    expect(line(container)?.textContent).toBe('Send this email to Eric?');
    // The question is answered in the session; the card carries no copy of
    // the session's own form.
    expect(container.querySelector('form, input, textarea')).toBeNull();

    fireEvent.click(outputRow(container)!);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('Magic Chip inside an editor', () => {
  it('collapses even when the editor stops delegated clicks', () => {
    const collapse = vi.fn();
    render(() => (
      <div on:click={(event) => event.stopPropagation()}>
        <MagicChipView
          agentSessionId="session"
          presentation={{ kind: 'settled', markdown: 'Latest answer' }}
          onCollapse={collapse}
        />
      </div>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse to mention' })
    );
    expect(collapse).toHaveBeenCalledOnce();
  });
});
