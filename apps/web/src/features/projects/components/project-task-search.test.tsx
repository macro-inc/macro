/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { ProjectTaskSearch } from './project-task-search';

vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Surface')),
  ...(await import('@ui/utils/classname')),
  Hotkey: () => null,
}));

function setup(initialValue = '') {
  const [value, setValue] = createSignal(initialValue);
  render(() => (
    <ProjectTaskSearch
      projectName="Launch"
      value={value()}
      onValueChange={setValue}
    />
  ));
  return value;
}

it('starts collapsed and focuses search when expanded', async () => {
  const value = setup();
  expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search in Launch' }));
  const input = screen.getByRole('searchbox', { name: 'Search in Launch' });
  expect(input.getAttribute('placeholder')).toBe('Search in Launch');
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: 'Release' } });
  expect(value()).toBe('Release');
});

it.each(['button', 'Escape'])(
  'closes with %s and restores focus',
  async (via) => {
    const value = setup('Release');
    const input = screen.getByRole('searchbox', {
      name: 'Search in Launch',
    });
    await waitFor(() => expect(document.activeElement).toBe(input));
    if (via === 'button') {
      fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    } else {
      fireEvent.keyDown(input, { key: 'Escape' });
    }
    expect(value()).toBe('');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Search in Launch' })
      )
    );
  }
);
