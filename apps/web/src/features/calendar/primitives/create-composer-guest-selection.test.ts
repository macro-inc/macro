import { recipientEntityMapper } from '@core/user';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { guestEmail } from '../components/composer/event-form-model';
import { createComposerGuestSelection } from './create-composer-guest-selection';

it('consumes picked custom metadata only for the matching selection commit', () => {
  createRoot((dispose) => {
    const onChange = vi.fn();
    const selection = createComposerGuestSelection({
      options: () => [],
      selected: () => [],
      excluded: () => [],
      onChange,
    });
    selection.pick(
      {
        id: 'macro|first@example.com',
        email: 'first@example.com',
        name: 'First',
      },
      true
    );
    selection.commit(new Set(['macro|first@example.com']));
    selection.commit(new Set(['macro|second@example.com']));
    expect(onChange.mock.calls[0][0].map(guestEmail)).toEqual([
      'first@example.com',
    ]);
    expect(onChange.mock.calls[1][0].map(guestEmail)).toEqual([
      'second@example.com',
    ]);
    dispose();
  });
});

describe('known composer guests', () => {
  it('matches normalized email identifiers without replacing known metadata', () => {
    createRoot((dispose) => {
      const known = recipientEntityMapper('user')({
        id: 'macro|guest@example.com',
        email: 'Guest@example.com',
        name: 'Guest',
      });
      const onChange = vi.fn();
      const selection = createComposerGuestSelection({
        options: () => [],
        selected: () => [known],
        excluded: () => [],
        onChange,
      });
      selection.commit(new Set(['macro|GUEST@example.com']));
      expect(onChange).toHaveBeenCalledWith([known]);
      dispose();
    });
  });
});
