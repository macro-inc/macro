/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailThreadTitle } from './EmailThreadTitle';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

afterEach(cleanup);

describe('EmailThreadTitle', () => {
  it('marks the heading as selectable text', () => {
    render(() => (
      <EmailThreadTitle title="Q3 contract review" copyReveal="hover" />
    ));

    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'select-text'
    );
  });

  it('keeps the last word and copy button on one line', () => {
    render(() => (
      <EmailThreadTitle
        title="Q3 contract review for the Acme renewal"
        copyReveal="always"
      />
    ));

    const lastWord = screen.getByText('renewal');
    const cluster = lastWord.closest('span');
    const copy = screen.getByRole('button', { name: 'Copy subject' });

    expect(cluster?.className).toContain('whitespace-nowrap');
    expect(cluster?.contains(copy)).toBe(true);
  });
});
