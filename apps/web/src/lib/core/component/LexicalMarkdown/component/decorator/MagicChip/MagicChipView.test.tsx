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
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(area.className).toContain('h-22');
    expect(area.textContent).not.toContain('Show less');

    fireEvent.click(area);
    expect(area.getAttribute('aria-expanded')).toBe('true');
    expect(area.className).not.toContain('h-22');
    expect(clip()?.className).not.toContain('overflow-hidden');
    expect(area.textContent).toContain('Show less');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(area, { key: 'Enter' });
    expect(area.getAttribute('aria-expanded')).toBe('false');
    expect(area.className).toContain('h-22');
    expect(clip()?.className).toContain('overflow-hidden');
    expect(area.textContent).not.toContain('Show less');
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
