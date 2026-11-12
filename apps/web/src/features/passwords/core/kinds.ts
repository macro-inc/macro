import type { PasswordKind } from './types';

/**
 * Where a kind's field lives in the stored values. Until typed item secrets
 * exist, every kind maps onto the same username/password/url/notes slots, and
 * extra semantic fields are labeled custom fields seeded when the draft starts.
 */
export type PasswordSlot = 'username' | 'password' | 'url' | 'notes';

export type PasswordSlotLabel =
  | 'username'
  | 'password'
  | 'website'
  | 'notes'
  | 'cardholder'
  | 'cardNumber'
  | 'note'
  | 'fullName'
  | 'endpoint'
  | 'apiKey'
  | 'apiSecret'
  | 'account';

export type PasswordTemplateField =
  | 'expires'
  | 'securityCode'
  | 'email'
  | 'phone'
  | 'address'
  | 'environment';

export type PasswordKindLayout = {
  /** Slots shown for this kind, in display order, with their kind-specific label. */
  slots: { slot: PasswordSlot; label: PasswordSlotLabel }[];
  /** Custom fields a new draft of this kind starts with. */
  template: { field: PasswordTemplateField; secret: boolean }[];
  /** Whether the kind offers a verification code. */
  totp: 'optional' | 'required' | 'none';
  /** Whether the password generator applies to the password slot. */
  generator: boolean;
};

export const PASSWORD_KINDS = [
  'login',
  'card',
  'note',
  'identity',
  'api',
  'verification_code',
] as const satisfies readonly PasswordKind[];

export const KIND_LAYOUTS: Record<PasswordKind, PasswordKindLayout> = {
  login: {
    slots: [
      { slot: 'username', label: 'username' },
      { slot: 'password', label: 'password' },
      { slot: 'url', label: 'website' },
      { slot: 'notes', label: 'notes' },
    ],
    template: [],
    totp: 'optional',
    generator: true,
  },
  card: {
    slots: [
      { slot: 'username', label: 'cardholder' },
      { slot: 'password', label: 'cardNumber' },
      { slot: 'notes', label: 'notes' },
    ],
    template: [
      { field: 'expires', secret: false },
      { field: 'securityCode', secret: true },
    ],
    totp: 'none',
    generator: false,
  },
  note: {
    slots: [{ slot: 'notes', label: 'note' }],
    template: [],
    totp: 'none',
    generator: false,
  },
  identity: {
    slots: [
      { slot: 'username', label: 'fullName' },
      { slot: 'notes', label: 'notes' },
    ],
    template: [
      { field: 'email', secret: false },
      { field: 'phone', secret: false },
      { field: 'address', secret: false },
    ],
    totp: 'none',
    generator: false,
  },
  api: {
    slots: [
      { slot: 'url', label: 'endpoint' },
      { slot: 'username', label: 'apiKey' },
      { slot: 'password', label: 'apiSecret' },
      { slot: 'notes', label: 'notes' },
    ],
    template: [{ field: 'environment', secret: false }],
    totp: 'none',
    generator: true,
  },
  verification_code: {
    slots: [{ slot: 'username', label: 'account' }],
    template: [],
    totp: 'required',
    generator: false,
  },
};

export function kindHasSlot(kind: PasswordKind, slot: PasswordSlot) {
  return KIND_LAYOUTS[kind].slots.some((entry) => entry.slot === slot);
}
