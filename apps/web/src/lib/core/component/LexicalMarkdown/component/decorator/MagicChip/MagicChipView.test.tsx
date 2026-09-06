/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';

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

    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(1);
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

    const body = container.querySelector('[data-message-reply-preview]');
    expect(body?.className).toContain('overflow-hidden');
    expect(body?.textContent).toBe('Hello from the agent');

    const footer = container.querySelector('[data-magic-chip-preview] button');
    expect(footer?.textContent).toContain('Writing response');
    expect(footer?.textContent).not.toContain('Open session');

    fireEvent.click(body!);
    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(2);
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
