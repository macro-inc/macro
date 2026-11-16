import type { IUser } from '@core/user';
import {
  guestEmail,
  type SelectedEventEditorGuest,
} from '../components/composer/event-form-model';

export function composerGuestName(guest: SelectedEventEditorGuest): string {
  return ('name' in guest.data && guest.data.name) || guest.data.email;
}

export function composerGuestKey(guest: SelectedEventEditorGuest): string {
  return `macro|${guestEmail(guest).toLowerCase()}`;
}

export function composerGuestUser(guest: SelectedEventEditorGuest): IUser {
  return {
    id: composerGuestKey(guest),
    email: guestEmail(guest),
    name: composerGuestName(guest),
  };
}
