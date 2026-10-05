import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui/components/ImperativeDialog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseTemplatePicker } from './database-template-picker';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@queries/storage/databases', () => ({
  useDatabaseTemplatesQuery: () => ({
    isPending: false,
    isError: false,
    data: [
      {
        id: 'project_tracker',
        name: 'Project tracker',
        description: 'Plan work on a board grouped by status.',
        icon: 'kanban',
      },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onChoose = vi.fn(() => {
    screen.getByRole('textbox', { name: 'Database title' }).focus();
  });
  render(() => (
    <>
      <button
        type="button"
        onClick={() => openDatabaseTemplatePicker(onChoose)}
      >
        New database
      </button>
      <input aria-label="Database title" />
      <ImperativeDialogHost />
    </>
  ));
  const trigger = screen.getByRole('button', { name: 'New database' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, onChoose };
}

describe('database template picker focus', () => {
  it.each(['Blank', 'Project tracker'])(
    'keeps focus on the new database after choosing %s',
    async (option) => {
      const { onChoose } = setup();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('option', { name: 'Blank' })
        )
      );
      vi.useFakeTimers();
      fireEvent.click(screen.getByRole('option', { name: option }));
      await vi.runAllTimersAsync();

      expect(onChoose).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Database title' })
      );
    }
  );

  it('restores the opener on dismissal and focuses Blank again on reopening', async () => {
    const { trigger, onChoose } = setup();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) fireEvent.click(trigger);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('option', { name: 'Blank' })
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(onChoose).not.toHaveBeenCalled();
  });
});
