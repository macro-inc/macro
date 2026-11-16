import { recipientEntityMapper } from '@core/user';
import { describe, expect, it, vi } from 'vitest';
import { createComposerGuestAdditions } from './create-composer-guest-additions';

const current = recipientEntityMapper('user')({
  id: 'macro|fixed@example.com',
  email: 'fixed@example.com',
  name: 'Fixed guest',
});
const added = recipientEntityMapper('user')({
  id: 'macro|added@example.com',
  email: 'added@example.com',
  name: 'Added guest',
});

describe('composer guest additions', () => {
  it('never removes an invited guest or re-adds one as a new invitation', () => {
    const onChange = vi.fn();
    const collection = createComposerGuestAdditions({
      current: () => [current],
      added: () => [added],
      disabled: () => false,
      onChange,
    });
    collection.remove(current);
    collection.add([current, added]);
    expect(onChange).not.toHaveBeenCalled();
    expect(collection.canRemove(current)).toBe(false);
  });

  it('keeps additions unchanged when permission is revoked before a callback', () => {
    const onChange = vi.fn();
    let disabled = false;
    const collection = createComposerGuestAdditions({
      current: () => [current],
      added: () => [added],
      disabled: () => disabled,
      onChange,
    });
    disabled = true;
    collection.remove(added);
    collection.replace([]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
