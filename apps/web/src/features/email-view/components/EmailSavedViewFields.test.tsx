import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_EMAIL_SAVED_VIEW_FILTERS,
  type EmailSavedViewFilters,
} from '../filters/email-saved-view';
import type { EmailParticipantSuggestion } from '../queries/use-email-participant-suggestions';
import { EmailSavedViewFields } from './EmailSavedViewFields';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const SUGGESTIONS: EmailParticipantSuggestion[] = [
  { type: 'domain', domain: 'globex.example', company: 'Globex' },
  { type: 'domain', domain: 'example.com', contacts: 2 },
  { type: 'address', email: 'ada@example.com', name: 'Ada' },
  { type: 'address', email: 'bo@example.com', name: 'Bo' },
];

afterEach(cleanup);

function renderFields() {
  const [filters, setFilters] = createSignal<EmailSavedViewFilters>(
    EMPTY_EMAIL_SAVED_VIEW_FILTERS
  );
  render(() => (
    <EmailSavedViewFields
      filters={filters()}
      onChange={setFilters}
      inboxes={[]}
      suggestions={() => SUGGESTIONS}
    />
  ));
  return {
    input: screen.getByRole<HTMLInputElement>('combobox', {
      name: 'People and companies',
    }),
    participants: () => filters().participants,
  };
}

describe('EmailSavedViewFields people and companies', () => {
  it('lists a matching domain before the people who use it', async () => {
    const user = userEvent.setup();
    const { input } = renderFields();
    await user.click(input);
    await user.type(input, 'example.com');

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'example.com2 contacts',
      'Adaada@example.com',
      'Bobo@example.com',
    ]);
  });

  it('adds a domain and a person from the same field', async () => {
    const user = userEvent.setup();
    const { input, participants } = renderFields();
    await user.click(input);
    await user.type(input, 'example.com');
    await user.click(
      await screen.findByRole('option', { name: 'example.com' })
    );
    await user.click(await screen.findByRole('option', { name: 'Ada' }));

    expect(participants()).toEqual([
      { type: 'domain', domain: 'example.com' },
      { type: 'address', email: 'ada@example.com' },
    ]);
  });

  it('reads typed addresses as people and @domains or websites as domains', () => {
    const { input, participants } = renderFields();
    fireEvent.input(input, {
      target: { value: 'Cy@Team.example, @vendor.example, www.site.example,' },
    });

    expect(participants()).toEqual([
      { type: 'address', email: 'cy@team.example' },
      { type: 'domain', domain: 'vendor.example' },
      { type: 'domain', domain: 'site.example' },
    ]);
  });
});
