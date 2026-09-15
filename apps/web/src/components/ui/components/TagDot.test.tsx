/** @vitest-environment jsdom */
import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { TagDot } from './TagDot';

describe('TagDot', () => {
  it('renders a single fill with configurable sizing and native attributes', () => {
    render(() => (
      <TagDot fill="blue" size="lg" class="opacity-50" data-testid="dot" />
    ));
    const dot = screen.getByTestId('dot');
    expect(dot.style.background).toBe('blue');
    expect(dot.dataset.size).toBe('lg');
    expect(dot.classList.contains('size-3')).toBe(true);
    expect(dot.classList.contains('opacity-50')).toBe(true);
  });
  it('reacts to fills, combines repetitions and caps distinct colors at four', () => {
    const [fills, setFills] = createSignal(['blue', 'yellow']);
    render(() => <TagDot fills={fills()} data-testid="dot" />);
    const background = () => screen.getByTestId('dot').style.background;
    expect(background()).toBe('conic-gradient(blue 0% 50%, yellow 50% 100%)');
    setFills(['blue', 'blue', 'yellow', 'red', 'green', 'purple']);
    expect(background()).toBe(
      'conic-gradient(blue 0% 40%, yellow 40% 60%, red 60% 80%, green 80% 100%)'
    );
    setFills(['yellow', 'yellow']);
    expect(background()).toBe('yellow');
  });
});
