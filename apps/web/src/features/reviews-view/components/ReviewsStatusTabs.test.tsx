/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewsStatusTabId } from '../reviews-types';
import { ReviewsStatusTabs } from './ReviewsStatusTabs';

vi.mock('@ui', async () => await import('@ui/components/Tabs'));

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReviewsStatusTabs', () => {
  it('shows only Open and Closed in a named group', () => {
    render(() => <ReviewsStatusTabs value="open" onChange={() => {}} />);
    expect(
      screen.getByRole('radiogroup', { name: 'Pull request status' })
    ).toBeTruthy();
    expect(
      screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))
    ).toEqual(['open', 'closed']);
    expect(screen.getByRole('radio', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Closed' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'All' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Merged' })).toBeNull();
  });

  it('reports every choice and follows the controlled value', () => {
    const [value, setValue] = createSignal<ReviewsStatusTabId>('closed');
    const onChange = vi.fn();
    render(() => <ReviewsStatusTabs value={value()} onChange={onChange} />);
    const closed = screen.getByRole('radio', {
      name: 'Closed',
    }) as HTMLInputElement;
    expect(closed.checked).toBe(true);
    for (const [name, id] of [
      ['Open', 'open'],
      ['Closed', 'closed'],
    ] as const) {
      const radio = screen.getByRole('radio', { name }) as HTMLInputElement;
      fireEvent.click(radio);
      expect(onChange).toHaveBeenLastCalledWith(id);
      if (id === 'open') expect(closed.checked).toBe(true);
      setValue(id);
      expect(radio.checked).toBe(true);
    }
  });

  it('selects statuses with the arrow keys', async () => {
    const [value, setValue] = createSignal<ReviewsStatusTabId>('open');
    render(() => <ReviewsStatusTabs value={value()} onChange={setValue} />);
    const open = screen.getByRole('radio', {
      name: 'Open',
    }) as HTMLInputElement;
    const closed = screen.getByRole('radio', {
      name: 'Closed',
    }) as HTMLInputElement;
    open.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(value()).toBe('closed');
    expect(closed.checked).toBe(true);
    await userEvent.keyboard('{ArrowLeft}');
    expect(value()).toBe('open');
    expect(open.checked).toBe(true);
  });

  it('does not imply the combined Closed preset for a partial menu selection', () => {
    const [value, setValue] = createSignal<ReviewsStatusTabId>();
    render(() => <ReviewsStatusTabs value={value()} onChange={setValue} />);
    expect(
      screen
        .getAllByRole('radio')
        .every((radio) => !(radio as HTMLInputElement).checked)
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    expect(value()).toBe('closed');
    expect(
      (screen.getByRole('radio', { name: 'Closed' }) as HTMLInputElement)
        .checked
    ).toBe(true);
  });
});
