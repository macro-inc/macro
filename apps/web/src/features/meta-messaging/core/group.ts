/** Group-specific, sanitized setup copy. Provider responses are never displayed. */
export function groupError(code?: string | null): string {
  if (code?.includes('group_ineligible'))
    return 'This account is not ready to create WhatsApp groups. Check its business eligibility and group webhook setup.';
  if (code?.includes('forbidden'))
    return 'You no longer have permission to manage this WhatsApp group.';
  if (code?.includes('group_unconfirmed'))
    return 'Could not confirm this group operation. Open the existing setup and check its status before retrying.';
  if (
    code?.includes('authorization_expired') ||
    code?.includes('access_denied')
  )
    return 'Reconnect the WhatsApp account in Settings, then retry group setup.';
  return 'WhatsApp could not complete group setup. Check the connected account and group webhook configuration, then retry this setup.';
}
