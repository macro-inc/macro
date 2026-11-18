import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerVisibility } from './ComposerVisibility';

afterEach(cleanup);

it('displays confidential as Private without changing stored metadata on mount or open', async () => {
  let model!: ReturnType<typeof createCalendarComposer>;
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
        title: 'Planning',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    model = createCalendarComposer({
      controller,
      pending: false,
      isEdit: true,
      initialMetadata: { visibility: 'confidential' },
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerVisibility />
      </ComposerRoot>
    );
  });
  expect(
    screen.getByRole('button', { name: 'Visibility' }).textContent
  ).toContain('Private');
  await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
  expect(model.visibility()).toBe('confidential');
  expect(model.submission()?.changes).toEqual({});
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }));
  expect(model.submission()?.changes).toEqual({ visibility: 'public' });
});
