import type { GuestPolicy } from '@service-storage/generated/schemas/guestPolicy';
import type { Accessor } from 'solid-js';

export function createComposerGuestPermissions(options: {
  value: Accessor<GuestPolicy>;
  disabled: Accessor<boolean>;
  onChange: (value: GuestPolicy) => void;
}) {
  const isDisabled = (key: keyof GuestPolicy) =>
    options.disabled() ||
    (key === 'canInviteOthers' && options.value().canModify);
  return {
    isDisabled,
    change: (key: keyof GuestPolicy, checked: boolean) => {
      if (isDisabled(key)) return;
      const next = { ...options.value(), [key]: checked };
      if (next.canModify) next.canInviteOthers = true;
      options.onChange(next);
    },
  };
}
