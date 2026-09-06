/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);

import { MagicChipView } from './MagicChipView';

const LONG_PATH =
  '/home/ubuntu/.cursor/projects/workspace/terminals/261831.txt'.repeat(8);

describe('MagicChipView', () => {
  it('keeps a streaming thought inside the message column', () => {
    const { container } = render(() => (
      <div style={{ width: '320px' }}>
        <MagicChipView
          agentSessionId="session-1"
          presentation={{
            kind: 'working',
            activity: {
              label: 'Thinking',
              detail: LONG_PATH,
              busy: true,
            },
          }}
        />
      </div>
    ));

    const chip = container.querySelector('[data-magic-chip="session-1"]');
    expect(chip?.className).toContain('min-w-0');
    expect(chip?.className).toContain('max-w-full');
    expect(chip?.className).toContain('overflow-x-hidden');
    expect(screen.getByText('Thinking')).toBeTruthy();
    expect(screen.getByText(LONG_PATH).className).toContain('truncate');
  });

  it('keeps a streaming answer inside the message column', () => {
    const { container } = render(() => (
      <div style={{ width: '320px' }}>
        <MagicChipView
          agentSessionId="session-2"
          presentation={{
            kind: 'answering',
            markdown: `Inspecting \`${LONG_PATH}\``,
            activity: {
              label: 'Reading files',
              detail: LONG_PATH,
              busy: true,
            },
          }}
        />
      </div>
    ));

    const chip = container.querySelector('[data-magic-chip="session-2"]');
    expect(chip?.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(chip?.className).toContain('overflow-x-hidden');
    expect(screen.getByText('Reading files')).toBeTruthy();
  });
});
