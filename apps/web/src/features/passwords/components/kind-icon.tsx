import CodeIcon from '@icon/system/regular/code.svg';
import CreditCardIcon from '@icon/system/regular/credit-card.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import NoteIcon from '@icon/system/regular/note.svg';
import ShieldCheckIcon from '@icon/system/regular/shield-check.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { Component } from 'solid-js';
import type { PasswordKind } from '../core/types';

export const KIND_ICONS: Record<PasswordKind, Component<{ class?: string }>> = {
  login: GlobeIcon,
  card: CreditCardIcon,
  note: NoteIcon,
  identity: UserIcon,
  api: CodeIcon,
  verification_code: ShieldCheckIcon,
};
