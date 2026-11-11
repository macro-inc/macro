/** An initiative's canonical Status. */
export type InitiativeStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'canceled';

/** An initiative's canonical Priority. */
export type InitiativePriority = 'low' | 'medium' | 'high' | 'urgent';

/** The system Status options, by name. */
export const STATUS_OPTION_IDS: Record<InitiativeStatus, string> = {
  not_started: '00000001-0000-0000-0002-000000000001',
  in_progress: '00000001-0000-0000-0002-000000000002',
  in_review: '00000001-0000-0000-0002-000000000003',
  completed: '00000001-0000-0000-0002-000000000004',
  canceled: '00000001-0000-0000-0002-000000000005',
};

/** The system Priority options, by name. */
export const PRIORITY_OPTION_IDS: Record<InitiativePriority, string> = {
  low: '00000001-0000-0000-0003-000000000001',
  medium: '00000001-0000-0000-0003-000000000002',
  high: '00000001-0000-0000-0003-000000000003',
  urgent: '00000001-0000-0000-0003-000000000004',
};

/** @internal */
export function optionName<Name extends string>(
  options: Record<Name, string>,
  property: string,
  id: string | null | undefined,
): Name | undefined {
  if (id == null) return undefined;
  const entry = Object.entries<string>(options).find(
    ([, optionId]) => optionId === id,
  );
  if (!entry) throw new Error(`Unknown ${property} option ${id}`);
  return entry[0] as Name;
}
