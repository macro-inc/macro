/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: (props: { markdown: string }) => props.markdown,
  })
);

import { MagicChipView } from './MagicChipView';

afterEach(cleanup);

function expectContained(element: Element | null) {
  expect(element).not.toBeNull();
  expect(element?.classList.contains('max-w-full')).toBe(true);
  expect(element?.classList.contains('min-w-0')).toBe(true);
  expect(element?.classList.contains('overflow-x-hidden')).toBe(true);
}

describe('MagicChipView', () => {
  it('keeps a working activity line inside the chat column', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'working',
          activity: {
            label: 'Thinking',
            detail: 'a'.repeat(400),
            busy: true,
          },
        }}
      />
    ));

    const chip = container.querySelector('[data-magic-chip="session"]');
    expectContained(chip);
    expect(chip?.classList.contains('overflow-hidden')).toBe(true);
  });

  it('contains a streaming answer so long markdown cannot widen the chat', () => {
    const markdown = `\`\`\`\n${'https://example.com/'.repeat(40)}\n\`\`\``;
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'answering',
          markdown,
          activity: { label: 'Writing response', busy: true },
        }}
      />
    ));

    expectContained(container.querySelector('[data-magic-chip="session"]'));

    const answer = container.querySelector('[data-message-reply-preview]');
    expect(answer).not.toBeNull();
    expect(answer?.classList.contains('chat-markdown-container')).toBe(true);
    expect(answer?.classList.contains('max-w-full')).toBe(true);
    expect(answer?.classList.contains('min-w-0')).toBe(true);
    expect(answer?.classList.contains('overflow-x-auto')).toBe(true);
    expect(answer?.classList.contains('wrap-break-word')).toBe(true);
    expect(answer?.textContent).toContain('https://example.com/');
  });

  it('keeps a settled answer inside the chat column', () => {
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'settled',
          markdown: `| ${'wide'.repeat(80)} |\n| --- |\n| ${'cell'.repeat(80)} |`,
        }}
      />
    ));

    expectContained(container.querySelector('[data-magic-chip="session"]'));
    expect(container.querySelector('.chat-markdown-container')).not.toBeNull();
  });
});
