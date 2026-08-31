/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: (props: { markdown: string }) => (
      <span data-testid="answer">{props.markdown}</span>
    ),
  })
);

afterEach(() => cleanup());

const longAnswer =
  'The streamed answer keeps growing with more words that used to stretch the chip off the right edge of the channel as each token arrived.';

describe('MagicChipView', () => {
  it('pins streamed answer text to the message column', () => {
    const { container } = render(() => (
      <div style={{ width: '240px' }}>
        <MagicChipView
          agentSessionId="session-1"
          presentation={{
            kind: 'answering',
            markdown: longAnswer,
            activity: { label: 'Writing response', busy: true },
          }}
        />
      </div>
    ));

    const chip = container.querySelector('[data-magic-chip="session-1"]');
    expect(chip).toBeTruthy();
    expect(chip?.className).toMatch(/\bmin-w-0\b/);
    expect(chip?.className).toMatch(/\bmax-w-full\b/);
    expect(chip?.className).toMatch(/\boverflow-x-hidden\b/);
    expect(chip?.className).not.toMatch(/justify-items-start/);
    expect(container.querySelector('[data-testid="answer"]')?.textContent).toBe(
      longAnswer
    );
  });

  it('truncates a long activity detail instead of overflowing', () => {
    const detail =
      'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MagicChip/MagicChipView.tsx';
    const { container } = render(() => (
      <div style={{ width: '240px' }}>
        <MagicChipView
          agentSessionId="session-1"
          presentation={{
            kind: 'working',
            activity: {
              label: 'Reading files',
              detail,
              busy: true,
            },
          }}
        />
      </div>
    ));

    const truncated = container.querySelector('.truncate');
    expect(truncated?.textContent).toBe(detail);
    expect(
      container.querySelector('[data-magic-chip="session-1"]')?.className
    ).toMatch(/\boverflow-x-hidden\b/);
  });
});
