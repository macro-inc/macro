/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
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

describe('MagicChipView', () => {
  it('keeps working state as a single activity line', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: { label: 'Booting agent', busy: true },
        }}
      />
    ));

    expect(container.querySelector('[data-magic-chip-preview]')).toBeNull();
    expect(container.textContent).toContain('Booting agent');
  });

  it('clips the answering card and shows the activity in its footer', () => {
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

    const card = container.querySelector('[data-magic-chip-preview]');
    expect(card?.className).toContain('rounded-lg');
    expect(card?.className).not.toContain('border-accent');

    const body = card?.querySelector('[data-message-reply-preview]');
    expect(body?.className).toContain('max-h-32');
    expect(body?.className).toContain('overflow-hidden');
    expect(body?.textContent).toContain('Hello from the agent');

    const footer = card?.querySelector('button');
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

    const card = container.querySelector('[data-magic-chip-preview]');
    const footer = card?.querySelector('button');
    expect(footer?.textContent).toContain('Open session');
    fireEvent.click(footer!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('uses the rendered answer as the reply preview, not the footer', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'answering',
          markdown: 'Answer text',
          activity: { label: 'Writing response', busy: true },
        }}
      />
    ));

    const preview = container.querySelector('[data-message-reply-preview]');
    expect(preview?.textContent).toBe('Answer text');
  });
});
