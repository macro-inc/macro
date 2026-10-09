import type { FormAudience, FormMetadata } from './form-model';

/** Whether a form takes responses now, and the line the tab strip shows. */
export type FormAvailability =
  | { kind: 'open'; closesAt: Date | null }
  | { kind: 'closed'; reason: 'closed' | 'deadline' }
  | { kind: 'table-gone' };

export function formAvailability(
  form: FormMetadata,
  tableGone: boolean,
  now: Date
): FormAvailability {
  if (tableGone) return { kind: 'table-gone' };
  if (form.status === 'closed') return { kind: 'closed', reason: 'closed' };
  const closesAt = form.closesAt ? new Date(form.closesAt) : null;
  if (closesAt && closesAt.getTime() <= now.getTime())
    return { kind: 'closed', reason: 'deadline' };
  return { kind: 'open', closesAt };
}

/** "Oct 3" this year, "Oct 3, 2027" otherwise. */
export function shortDate(date: Date, now: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/** "Accepting responses · closes Oct 3", "Closed", or "Table deleted". */
export function availabilityLine(
  availability: FormAvailability,
  now: Date
): string {
  if (availability.kind === 'table-gone') return 'Table deleted';
  if (availability.kind === 'closed') return 'Closed';
  return availability.closesAt
    ? `Accepting responses · closes ${shortDate(availability.closesAt, now)}`
    : 'Accepting responses';
}

/**
 * The form page's one primary button (RFC 02 §2): Publish (opens sharing)
 * while nobody has responded and it is shared with no one, Open form after.
 * `shared` is undefined while unknown, which keeps Publish.
 */
export function primaryAction(facts: {
  audience: FormAudience;
  responses: number;
  shared: boolean | undefined;
}): 'publish' | 'open' {
  return facts.audience === 'public' || facts.responses > 0 || facts.shared
    ? 'open'
    : 'publish';
}
