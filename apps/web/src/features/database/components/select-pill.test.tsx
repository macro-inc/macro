import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { SelectPill } from './select-pill';

afterEach(cleanup);

it('draws a stored option colour instead of guessing one from the label', () => {
  render(() => (
    <SelectPill
      label="Blocked"
      column={{
        id: 'status',
        name: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        options: [
          { id: 'done', label: 'Done', color: null },
          { id: 'blocked', label: 'Blocked', color: '#123456' },
        ],
        writable: true,
      }}
    />
  ));
  const dot = screen
    .getByTitle('Blocked')
    .querySelector<HTMLElement>('[data-slot="tag-dot"]');
  expect(dot?.style.backgroundColor).toBe('rgb(18, 52, 86)');
});

it('leaves an uncoloured select option as a plain label, like a task', () => {
  render(() => (
    <SelectPill
      label="Done"
      column={{
        id: 'status',
        name: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        options: [
          { id: 'done', label: 'Done', color: null },
          { id: 'blocked', label: 'Blocked', color: null },
        ],
        writable: true,
      }}
    />
  ));
  expect(
    screen.getByTitle('Done').querySelector('[data-slot="tag-dot"]')
  ).toBeNull();
});

it('gives an uncoloured tag the default tag dot', () => {
  render(() => (
    <SelectPill
      label="Done"
      column={{
        id: 'status',
        name: 'Status',
        dataType: 'TAG',
        isMultiSelect: false,
        options: [
          { id: 'done', label: 'Done', color: null },
          { id: 'blocked', label: 'Blocked', color: null },
        ],
        writable: true,
      }}
    />
  ));
  expect(
    screen.getByTitle('Done').querySelector('[data-slot="tag-dot"]')
  ).toBeTruthy();
});
