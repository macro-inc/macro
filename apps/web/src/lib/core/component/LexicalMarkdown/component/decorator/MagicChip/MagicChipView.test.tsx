/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
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

  it('caps the answering preview and opens the session on click', () => {
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

    const preview = container.querySelector('[data-magic-chip-preview]');
    expect(preview).toBeTruthy();
    expect(preview?.className).toContain('h-36');
    expect(preview?.className).toContain('overflow-auto');
    expect(container.textContent).toContain('Hello from the agent');
    expect(container.textContent).toContain('Writing response');

    fireEvent.click(preview!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps the settled preview the same height and clickable', () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'settled',
          markdown: 'All done',
        }}
        onOpen={onOpen}
      />
    ));

    const preview = container.querySelector('[data-magic-chip-preview]');
    expect(preview?.className).toContain('h-36');
    fireEvent.click(preview!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('pins the preview to the bottom as the answer grows', () => {
    const [markdown, setMarkdown] = createSignal('first');
    const { container } = render(() => (
      <MagicChipView
        agentSessionId="session"
        presentation={{
          kind: 'answering',
          markdown: markdown(),
          activity: { label: 'Writing response', busy: true },
        }}
      />
    ));

    const preview = container.querySelector(
      '[data-magic-chip-preview]'
    ) as HTMLDivElement;
    Object.defineProperty(preview, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    });
    preview.scrollTop = 0;

    setMarkdown('first\n\nsecond paragraph of the answer');
    expect(preview.scrollTop).toBe(400);
  });
});
