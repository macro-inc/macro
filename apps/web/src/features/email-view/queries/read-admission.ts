import type { EmailEntity } from '@entity';

/** Each retained lookup can return its entire explicit ID set in one page. */
export const EMAIL_ADMISSION_BATCH_SIZE = 100;

/** Keep previously admitted occurrences anchored among current discovery rows.
 * Current rows own their metadata and relative order; missing rows keep their
 * previous position until the ID-scoped reader determines current membership. */
export function mergeEmailAdmission(
  previous: readonly EmailEntity[],
  current: readonly EmailEntity[]
): EmailEntity[] {
  const rows = [...new Map(current.map((email) => [email.id, email])).values()];
  const positions = new Map(rows.map((email, index) => [email.id, index]));
  const before = new Map<number, EmailEntity[]>();
  let anchor = rows.length;
  for (let index = previous.length - 1; index >= 0; index--) {
    const email = previous[index];
    const currentIndex = positions.get(email.id);
    if (currentIndex !== undefined) {
      anchor = currentIndex;
    } else {
      const bucket = before.get(anchor) ?? [];
      bucket.push(email);
      before.set(anchor, bucket);
    }
  }
  return Array.from({ length: rows.length + 1 }, (_, index) => [
    ...(before.get(index)?.reverse() ?? []),
    ...(index < rows.length ? [rows[index]] : []),
  ]).flat();
}

export function emailAdmissionBatches(
  emails: readonly EmailEntity[]
): string[][] {
  const batches: string[][] = [];
  for (
    let index = 0;
    index < emails.length;
    index += EMAIL_ADMISSION_BATCH_SIZE
  ) {
    batches.push(
      emails
        .slice(index, index + EMAIL_ADMISSION_BATCH_SIZE)
        .map((email) => email.id)
    );
  }
  return batches;
}
