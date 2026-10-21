import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { format } from 'date-fns';

export type DueDateTone = 'today' | 'overdue' | 'scheduled';

export type DueDateFace = {
  text: string;
  tone: DueDateTone;
};

/** The due date on a property, when this property is the system due date. */
export function readDueDate(property: Property): Date | null {
  if (property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE)
    return null;
  if (property.valueType !== 'DATE' || property.value == null) return null;
  return property.value;
}

/** How a due date reads in a list or on a card. */
export function dueDateFace(value: Date, now = new Date()): DueDateFace {
  const day = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { text: 'Today', tone: 'today' };
  if (diff === -1) return { text: 'Yesterday', tone: 'overdue' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'scheduled' };
  const sameYear = value.getFullYear() === now.getFullYear();
  return {
    text: sameYear ? format(value, 'MMM d') : format(value, 'MMM d, yyyy'),
    tone: diff < 0 ? 'overdue' : 'scheduled',
  };
}
