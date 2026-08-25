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
  it('marks the heading as selectable text', () => {
    render(() => (
      <EmailThreadTitle title="Q3 contract review" copyReveal="hover" />
    ));

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toContain('select-text');
    expect(heading.className).toContain('cursor-text');
  });

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

  it('keeps the last word and copy button on one line', () => {
    render(() => (
      <EmailThreadTitle
        title="Q3 contract review for the Acme renewal and the associated vendor onboarding checklist"
        copyReveal="always"
      />
    ));

    const lastWord = screen.getByText('checklist');
    const cluster = lastWord.closest('span');
    const copy = screen.getByRole('button', { name: 'Copy subject' });

    expect(cluster?.className).toContain('whitespace-nowrap');
    expect(cluster?.contains(copy)).toBe(true);
    expect(copy.className).toContain('text-inherit');
    expect(copy.className).not.toContain('opacity-0');
  });

  it('does not force a single unspaced subject onto one line', () => {
    render(() => (
      <EmailThreadTitle
        title="VeryLongUnspacedSubjectLine"
        copyReveal="always"
      />
    ));

    const lastWord = screen.getByText('VeryLongUnspacedSubjectLine');
    expect(lastWord.closest('span')?.className ?? '').not.toContain(
      'whitespace-nowrap'
    );
  });
});
