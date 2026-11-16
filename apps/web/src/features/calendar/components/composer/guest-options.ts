import { recipientEntityMapper } from '@core/user/combinedRecipient';
import type { EventEditorGuestOption } from './event-form-model';

/** Event-owned addresses/names are scoped extras, not personal membership. */
export function eventGuestOptions(
  guests: readonly { email: string; name?: string | null }[]
): EventEditorGuestOption[] {
  const rows = new Map<string, EventEditorGuestOption>();
  for (const guest of guests) {
    const email = guest.email.trim();
    const key = email.toLowerCase();
    if (!email || rows.has(key)) continue;
    rows.set(
      key,
      recipientEntityMapper('contact')({
        id: `macro|${key}`,
        type: 'extracted',
        email,
        name: guest.name,
      })
    );
  }
  return [...rows.values()];
}
