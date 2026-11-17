import type { TagOptionSummary } from '@property/tags/tag-options';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const TAG_SET = '0198a4cc-e138-7670-a308-a6b766602700';
const URGENT = '0198a4cc-e138-7670-a308-a6b766602701';
const INVOICES = '0198a4cc-e138-7670-a308-a6b766602702';
const DELETED = '0198a4cc-e138-7670-a308-a6b766602703';
const TAGS: TagOptionSummary[] = [
  { id: URGENT, label: 'Urgent', scope: 'user', propertyDefinitionId: TAG_SET },
  {
    id: INVOICES,
    label: 'Invoices',
    scope: 'user',
    propertyDefinitionId: TAG_SET,
  },
];

// The Advanced settings disclosure measures its body.
beforeEach(() => {
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

function renderFields(initial = EMPTY_EMAIL_SAVED_VIEW_FILTERS) {
  const [filters, setFilters] = createSignal<EmailSavedViewFilters>(initial);
  render(() => (
    <EmailSavedViewFields
      filters={filters()}
      onChange={setFilters}
      inboxes={[]}
      suggestions={() => SUGGESTIONS}
      tags={TAGS}
    />
  ));
  return {
    input: screen.getByRole<HTMLInputElement>('combobox', {
      name: 'People',
    }),
    participants: () => filters().participants,
    tags: () => filters().tags,
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

describe('EmailSavedViewFields advanced settings', () => {
  const importance = () =>
    screen.queryByRole('tablist', { name: 'Importance' }) ??
    screen.queryByRole('radiogroup', { name: 'Importance' });

  it('keeps the other filters behind Advanced settings', async () => {
    const user = userEvent.setup();
    renderFields();
    const toggle = screen.getByRole('button', { name: 'Advanced settings' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(importance()).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Subject contains' })
    ).toBeTruthy();

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(importance()).not.toBeNull();
  });

  it('starts open when the view already uses one of them', () => {
    renderFields({ ...EMPTY_EMAIL_SAVED_VIEW_FILTERS, read: 'unread' });

    expect(
      screen
        .getByRole('button', { name: 'Advanced settings' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(importance()).not.toBeNull();
  });
});

describe('EmailSavedViewFields tags', () => {
  it('picks tags without opening Advanced settings and keeps their sets', async () => {
    const user = userEvent.setup();
    const { tags } = renderFields();
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.click(input);
    await user.type(input, 'inv');
    await user.click(await screen.findByRole('option', { name: 'Invoices' }));

    expect(tags()).toEqual([
      { optionId: INVOICES, propertyDefinitionId: TAG_SET },
    ]);
    expect(
      screen
        .getByRole('button', { name: 'Advanced settings' })
        .getAttribute('aria-expanded')
    ).toBe('false');
  });

  it('keeps a tag the viewer can no longer see when adding another', async () => {
    const user = userEvent.setup();
    const deleted = { optionId: DELETED, propertyDefinitionId: TAG_SET };
    const { tags } = renderFields({
      ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
      tags: [deleted],
    });
    expect(screen.getByText('Unavailable tag')).toBeTruthy();

    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'Urgent' }));

    expect(tags()).toEqual([
      deleted,
      { optionId: URGENT, propertyDefinitionId: TAG_SET },
    ]);
  });
});
