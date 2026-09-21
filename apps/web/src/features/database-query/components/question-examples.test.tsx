import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionExamples } from './question-examples';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('question example placeholder', () => {
  it('rotates without announcing decorative text and disposes pending work', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const rendered = render(() => (
      <QuestionExamples
        examples={['List customers', 'Chart monthly revenue']}
      />
    ));
    expect(
      rendered.getByText('List customers').getAttribute('aria-hidden')
    ).toBe('true');
    vi.advanceTimersByTime(4500);
    expect(
      rendered.getByText('List customers').classList.contains('opacity-0')
    ).toBe(true);
    vi.advanceTimersByTime(180);
    expect(rendered.getByText('Chart monthly revenue')).toBeTruthy();
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('respects reduced motion and does not start a rotation timer', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const rendered = render(() => (
      <QuestionExamples
        examples={['List customers', 'Chart monthly revenue']}
      />
    ));
    vi.advanceTimersByTime(10000);
    expect(rendered.getByText('List customers')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    rendered.unmount();
  });
});
