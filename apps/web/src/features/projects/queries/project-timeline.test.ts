import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { describe, expect, it } from 'vitest';
import type { Project } from '../core/project';
import {
  projectTimelineDates,
  projectTimelineTimed,
  projectTimelineWholeDay,
} from './project-timeline';

const CREATED = '2026-11-10T09:12:00Z';

function row(dates: {
  start?: { value: Date; hasTime?: boolean };
  due?: { value: Date; hasTime?: boolean };
}) {
  const property = (
    propertyDefinitionId: string,
    end: { value: Date; hasTime?: boolean }
  ) =>
    ({
      propertyDefinitionId,
      valueType: 'DATE',
      value: end.value,
      ...(end.hasTime ? { hasTime: true } : {}),
    }) as Property;
  return {
    project: { createdAt: CREATED } as unknown as Project,
    properties: [
      ...(dates.start
        ? [property(SYSTEM_PROPERTY_IDS.START_DATE, dates.start)]
        : []),
      ...(dates.due ? [property(SYSTEM_PROPERTY_IDS.DUE_DATE, dates.due)] : []),
    ],
  };
}

const START = new Date('2026-11-23T05:00:00Z');
const DUE = new Date('2026-11-27T05:00:00Z');

describe('projectTimelineDates', () => {
  it('starts a bar at the Start Date with start dates on, else at the created date', () => {
    const withStart = row({ start: { value: START }, due: { value: DUE } });
    expect(projectTimelineDates(withStart, true)).toEqual({
      start: START,
      end: DUE,
    });
    expect(projectTimelineDates(withStart)).toEqual({
      start: CREATED,
      end: DUE,
    });
    expect(projectTimelineDates(row({ due: { value: DUE } }), true)).toEqual({
      start: CREATED,
      end: DUE,
    });
  });

  it('marks a bar timed when either end has a time, and names the end without one', () => {
    const mixed = row({
      start: { value: START },
      due: { value: DUE, hasTime: true },
    });
    expect(projectTimelineTimed(mixed)).toBe(true);
    expect(projectTimelineWholeDay(mixed)).toBe('start');
    const wholeDays = row({ start: { value: START }, due: { value: DUE } });
    expect(projectTimelineTimed(wholeDays)).toBe(false);
    expect(projectTimelineWholeDay(wholeDays)).toBeUndefined();
  });
});
