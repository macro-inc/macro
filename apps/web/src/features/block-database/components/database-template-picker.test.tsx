import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseTemplates } from '../core/database-creation';
import { DatabaseTemplatePicker } from './database-template-picker';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('scrollTo', vi.fn());
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

const TEMPLATES: DatabaseTemplates = {
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
};

function setup(templates: DatabaseTemplates = TEMPLATES) {
  const onChoose = vi.fn();
  const onOpenChange = vi.fn();
  render(() => (
    <DatabaseTemplatePicker
      open
      onOpenChange={onOpenChange}
      templates={templates}
      onChoose={onChoose}
    />
  ));
  return { onChoose, onOpenChange };
}

describe('database template gallery', () => {
  it('defaults to no template and creates an empty database on confirmation', async () => {
    const { onChoose } = setup();
    const blank = screen.getByRole('radio', { name: 'No template' });
    expect(blank).toHaveProperty('checked', true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    await waitFor(() => expect(document.activeElement).toBe(blank));
    expect(onChoose).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Create database' })
    );

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Untitled database',
    });
  });

  it('lets people browse cards without creating until they confirm', async () => {
    const { onChoose } = setup();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Project tracker' })
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Reading list' }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Reading list' })).toHaveProperty(
      'checked',
      true
    );

    await userEvent.dblClick(
      screen.getByRole('button', { name: 'Use template' })
    );

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Reading list',
      template: 'reading_list',
    });
  });

  it('can return to no template after browsing a template', async () => {
    const { onChoose } = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Reading list' }));
    await userEvent.click(screen.getByRole('radio', { name: 'No template' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Create database' })
    );

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Untitled database',
    });
  });

  it('changes selection with arrows and confirms it with Enter', async () => {
    const { onChoose } = setup();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('radio', { name: 'No template' })
      )
    );

    await userEvent.keyboard('{ArrowDown}');
    expect(onChoose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');

    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      name: 'Project tracker',
      template: 'project_tracker',
    });
  });

  it.each(['loading', 'failed'] as const)(
    'keeps the empty default usable when templates are %s',
    async (status) => {
      const { onChoose } = setup({ status });
      expect(screen.getAllByRole('radio')).toHaveLength(1);
      expect(screen.getByRole('status').textContent).toContain(
        status === 'loading' ? 'Loading templates' : 'Templates could not load'
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Create database' })
      );

      expect(onChoose).toHaveBeenCalledExactlyOnceWith({
        name: 'Untitled database',
      });
    }
  );

  it('does not select a template or move focus when the gallery finishes loading', async () => {
    const [templates, setTemplates] = createSignal<DatabaseTemplates>({
      status: 'loading',
    });
    render(() => (
      <DatabaseTemplatePicker
        open
        onOpenChange={vi.fn()}
        templates={templates()}
        onChoose={vi.fn()}
      />
    ));
    const blank = screen.getByRole('radio', { name: 'No template' });
    await waitFor(() => expect(document.activeElement).toBe(blank));

    setTemplates(TEMPLATES);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(blank).toHaveProperty('checked', true);
    expect(document.activeElement).toBe(blank);
  });

  it('closes on Escape without creating the selected template', async () => {
    const { onChoose, onOpenChange } = setup();
    const template = screen.getByRole('radio', { name: 'Reading list' });
    await userEvent.click(template);
    fireEvent.keyDown(template, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('closes from Cancel without creating anything', async () => {
    const { onChoose, onOpenChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
