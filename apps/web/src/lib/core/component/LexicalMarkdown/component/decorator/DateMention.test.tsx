/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../plugins', () => ({ autoRegister: vi.fn() }));

import { DateMention } from './DateMention';

const chip = (date: string, displayFormat: string) =>
  render(() => (
    <DateMention date={date} displayFormat={displayFormat} key="k" theme={{}} />
  ));

describe('DateMention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Thursday afternoon, local time.
    vi.setSystemTime(new Date(2026, 8, 24, 16, 3));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the time of a moment, as an agent writes a busy block', () => {
    chip(new Date(2026, 8, 24, 15, 15).toISOString(), '3:15 PM');

    expect(screen.getByText('Today, 3:15 PM')).toBeTruthy();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('keeps a day picked in the editor a day', () => {
    chip(new Date(2026, 8, 24).toISOString(), 'Today');

    expect(screen.getByText('Today')).toBeTruthy();
  });
});
