import type { ActivityAction } from './event';

/** The property id a property-changed action refers to, else undefined. */
export function changedPropertyId(action: ActivityAction): string | undefined {
  return action.kind === 'property-changed' ? action.property : undefined;
}
