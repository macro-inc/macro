/**
 * Initials from a structured name, falling back to the email's first letter.
 * Two letters when both names are present, otherwise one.
 */
export function getInitials(
  firstName: string,
  lastName: string,
  email: string
): string {
  const first = firstName.trim();
  const last = lastName.trim();

  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  }
  if (first) {
    return first[0].toUpperCase();
  }
  return email.substring(0, 1).toUpperCase();
}

/**
 * Initials from a free-form display name (split on whitespace into first/last
 * tokens), falling back to the email's first letter. For data sources that
 * carry a single name string rather than structured first/last fields.
 */
export function getInitialsFromName(
  name: string | null | undefined,
  email: string
): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? (parts.at(-1) ?? '') : '';
  return getInitials(parts[0] ?? '', last, email);
}
