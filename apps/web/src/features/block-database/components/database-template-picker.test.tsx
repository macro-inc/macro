import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTemplatePicker } from './database-template-picker';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

afterEach(cleanup);

describe('database template picker', () => {
  it('offers Blank first, then every template with its name and description', async () => {
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={{
          status: 'ready',
          templates: [
            {
              id: 'project_tracker',
              name: 'Project tracker',
              description: 'Plan work on a board grouped by status.',
              icon: 'kanban',
            },
            {
              id: 'reading_list',
              name: 'Reading list',
              description: 'Books to read, reading, and finished.',
              icon: 'books',
            },
          ],
        }}
        onChoose={vi.fn()}
      />
    ));

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'BlankStart from an empty table.',
      'Project trackerPlan work on a board grouped by status.',
      'Reading listBooks to read, reading, and finished.',
    ]);
    await waitFor(() => expect(document.activeElement).toBe(options[0]));
  });

  it('creates from the chosen template, named after it', async () => {
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={{
          status: 'ready',
          templates: [
            {
              id: 'reading_list',
              name: 'Reading list',
              description: 'Books to read, reading, and finished.',
              icon: 'books',
            },
          ],
        }}
        onChoose={onChoose}
      />
    ));

    await userEvent.click(screen.getByRole('option', { name: 'Reading list' }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Reading list',
      template: 'reading_list',
    });
  });

  it('creates a blank database from Blank', async () => {
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={{
          status: 'ready',
          templates: [
            {
              id: 'reading_list',
              name: 'Reading list',
              description: 'Books to read, reading, and finished.',
              icon: 'books',
            },
          ],
        }}
        onChoose={onChoose}
      />
    ));

    await userEvent.click(screen.getByRole('option', { name: 'Blank' }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Untitled database',
    });
  });

  it('chooses the highlighted option with the arrow keys and Enter', async () => {
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={{
          status: 'ready',
          templates: [
            {
              id: 'event_planner',
              name: 'Event planner',
              description: 'Events, guests, and tasks.',
              icon: 'confetti',
            },
          ],
        }}
        onChoose={onChoose}
      />
    ));
    const blank = screen.getByRole('option', { name: 'Blank' });
    await waitFor(() => expect(document.activeElement).toBe(blank));

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Event planner',
      template: 'event_planner',
    });
  });

  it('keeps Blank usable while the templates load or after they fail', async () => {
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={{ status: 'failed' }}
        onChoose={onChoose}
      />
    ));

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Templates could not load.')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: 'Blank' }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Untitled database',
    });
  });

  it('closes on Escape without creating anything', async () => {
    const onOpenChange = vi.fn();
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={onOpenChange}
        templates={{ status: 'loading' }}
        onChoose={onChoose}
      />
    ));
    const blank = screen.getByRole('option', { name: 'Blank' });
    await waitFor(() => expect(document.activeElement).toBe(blank));

    fireEvent.keyDown(blank, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('closes from Cancel without creating anything', async () => {
    const onOpenChange = vi.fn();
    const onChoose = vi.fn();
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={onOpenChange}
        templates={{ status: 'loading' }}
        onChoose={onChoose}
      />
    ));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
