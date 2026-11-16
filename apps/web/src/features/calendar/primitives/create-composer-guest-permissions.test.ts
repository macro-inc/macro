import type { GuestPolicy } from '@service-storage/generated/schemas/guestPolicy';
import { describe, expect, it, vi } from 'vitest';
import { createComposerGuestPermissions } from './create-composer-guest-permissions';

describe('composer guest permissions', () => {
  it('preserves unrelated choices when modifying implies inviting', () => {
    const value: GuestPolicy = {
      canModify: false,
      canInviteOthers: false,
      canSeeOtherGuests: false,
    };
    const onChange = vi.fn();
    const permissions = createComposerGuestPermissions({
      value: () => value,
      disabled: () => false,
      onChange,
    });
    permissions.change('canModify', true);
    expect(onChange).toHaveBeenCalledWith({
      canModify: true,
      canInviteOthers: true,
      canSeeOtherGuests: false,
    });
  });

  it('checks current locks again when a stale control sends a change', () => {
    const onChange = vi.fn();
    let locked = false;
    const permissions = createComposerGuestPermissions({
      value: () => ({
        canModify: false,
        canInviteOthers: true,
        canSeeOtherGuests: true,
      }),
      disabled: () => locked,
      onChange,
    });
    locked = true;
    permissions.change('canSeeOtherGuests', false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
