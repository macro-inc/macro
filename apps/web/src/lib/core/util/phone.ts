/**
 * A stored E.164 number for people to read. North American numbers are
 * grouped as `+1 NNN-NNN-NNNN`; others stay as stored, since their grouping
 * varies by country. Matches the backend's `PhoneNumber::readable`.
 */
export function readablePhone(e164: string): string {
  const digits = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return digits ? `+1 ${digits[1]}-${digits[2]}-${digits[3]}` : e164;
}
