/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailThreadTitle } from './EmailThreadTitle';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

afterEach(cleanup);

describe('EmailThreadTitle', () => {
  it('hides the copy icon until the title is hovered', () => {
    render(() => (
      <EmailThreadTitle title="Q3 contract review" copyReveal="hover" />
    ));

    const heading = screen.getByRole('heading', { level: 1 });
    const copy = screen.getByRole('button', { name: 'Copy subject' });

    expect(copy.className).toContain('opacity-0');

    fireEvent.mouseEnter(heading);
    expect(copy.className).toContain('opacity-100');
    expect(copy.className).not.toContain('opacity-0');

    fireEvent.mouseLeave(heading);
    expect(copy.className).toContain('opacity-0');
  });
});
