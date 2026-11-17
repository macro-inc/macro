import { Popover } from '@kobalte/core/popover';
import type { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerGuests } from './ComposerGuests';

vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (
    props: ComponentProps<typeof PropertyEntitySelector>
  ) => (
    <input
      aria-label="Search guests"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose?.();
      }}
    />
  ),
}));

afterEach(cleanup);

it('closes guest search on Escape without also closing the composer', async () => {
  const closeComposer = vi.fn();
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: defaultEditorInitialValues(
        new Date('2030-01-01T09:00:00'),
        false
      ),
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      onSubmit: vi.fn(),
    });
    return (
      <Popover open>
        <Popover.Content
          class="portal-scope"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={closeComposer}
        >
          <ComposerRoot model={model}>
            <ComposerGuests />
          </ComposerRoot>
        </Popover.Content>
      </Popover>
    );
  });
  await userEvent.click(screen.getByRole('button', { name: /Add guests/ }));
  await userEvent.click(screen.getByRole('textbox', { name: 'Search guests' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Search guests' })).toBeNull();
  expect(closeComposer).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(closeComposer).toHaveBeenCalledOnce();
});
