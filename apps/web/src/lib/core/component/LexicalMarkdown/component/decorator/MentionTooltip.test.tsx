/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { MentionTooltip } from './MentionTooltip';

describe('MentionTooltip', () => {
  it('uses the shared tooltip surface and Hotkey rendering', () => {
    const { container } = render(() => <MentionTooltip show text="Open" />);

    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('↵')).toBeTruthy();

    const surface = container.querySelector('.bg-tooltip');
    expect(surface?.classList.contains('rounded-lg')).toBe(true);
    expect(surface?.classList.contains('p-2')).toBe(true);
    expect(surface?.classList.contains('text-xs')).toBe(true);
  });

  it('renders nothing when hidden', () => {
    const { container } = render(() => (
      <MentionTooltip show={false} text="Open" />
    ));

    expect(container.innerHTML).toBe('');
  });
});
