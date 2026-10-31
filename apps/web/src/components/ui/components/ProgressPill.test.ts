import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressPill, ProgressRing } from './ProgressPill';

afterEach(cleanup);

describe('ProgressPill', () => {
  it('shows an empty ring and zero progress for a zero total', () => {
    const { getByRole } = render(() =>
      createComponent(ProgressPill, {
        value: 0,
        max: 0,
        label: 'Tasks completed',
      })
    );
    const pill = getByRole('progressbar', { name: 'Tasks completed' });
    expect(pill.textContent).toBe('0/0');
    expect(pill.getAttribute('aria-valuenow')).toBe('0');
    expect(pill.getAttribute('aria-valuemax')).toBe('0');
    const circles = pill.querySelectorAll('circle');
    expect(circles[1].getAttribute('stroke-dashoffset')).toBe(
      circles[1].getAttribute('stroke-dasharray')
    );
    expect(circles[1].getAttribute('opacity')).toBe('0');
  });

  it('clamps ring fractions and exposed progress to the valid range', () => {
    const [value, setValue] = createSignal(-3);
    const { getByRole } = render(() =>
      createComponent(ProgressPill, {
        get value() {
          return value();
        },
        max: 4,
        label: 'Tasks completed',
      })
    );
    const pill = getByRole('progressbar', { name: 'Tasks completed' });
    const arc = pill.querySelectorAll('circle')[1];
    expect(arc.getAttribute('stroke-dashoffset')).toBe(
      arc.getAttribute('stroke-dasharray')
    );
    expect(pill.getAttribute('aria-valuenow')).toBe('0');
    expect(arc.getAttribute('opacity')).toBe('0');
    setValue(8);
    expect(pill.getAttribute('aria-valuenow')).toBe('4');
    expect(arc.getAttribute('stroke-dashoffset')).toBe('0');
    expect(arc.getAttribute('opacity')).toBe('1');
  });

  it('updates accessible name, value, maximum, and completed text reactively', () => {
    const [value, setValue] = createSignal(1);
    const [max, setMax] = createSignal(4);
    const [label, setLabel] = createSignal('Tasks completed');
    const { getByRole } = render(() =>
      createComponent(ProgressPill, {
        get value() {
          return value();
        },
        get max() {
          return max();
        },
        get label() {
          return label();
        },
      })
    );
    const pill = getByRole('progressbar', { name: 'Tasks completed' });
    expect(pill.textContent).toBe('1/4');
    expect(pill.getAttribute('aria-valuenow')).toBe('1');
    setValue(2);
    setMax(2);
    setLabel('Steps completed');
    expect(getByRole('progressbar', { name: 'Steps completed' })).toBe(pill);
    expect(pill.textContent).toBe('2/2');
    expect(pill.getAttribute('aria-valuenow')).toBe('2');
    expect(pill.getAttribute('aria-valuemax')).toBe('2');
  });
});

describe('ProgressRing', () => {
  it('handles non-finite fractions without invalid geometry', () => {
    const { container } = render(() =>
      createComponent(ProgressRing, { fraction: Number.NaN })
    );
    const arc = container.querySelectorAll('circle')[1];
    expect(arc.getAttribute('stroke-dashoffset')).toBe(
      arc.getAttribute('stroke-dasharray')
    );
  });

  it('keeps the indeterminate arc and reduced-motion-safe spinning', () => {
    const { container } = render(() =>
      createComponent(ProgressRing, { fraction: null })
    );
    expect(
      container
        .querySelector('svg')
        ?.classList.contains('motion-safe:animate-spin')
    ).toBe(true);
    const arc = container.querySelectorAll('circle')[1];
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(
      Number(arc.getAttribute('stroke-dasharray')) * 0.75
    );
  });
});
