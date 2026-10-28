import { describe, expect, it } from 'vitest';
import { entityPropertyFromApi, propertyValueToApi } from './converters';

const definition = {
  id: 'trip',
  display_name: 'Trip',
  data_type: 'DATE_RANGE',
  is_multi_select: false,
  is_metadata: false,
  is_system: false,
  owner: { scope: 'user', user_id: 'macro|ada@example.com' },
  specific_entity_type: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as const;

const assignment = {
  id: 'assignment',
  entity_id: 'document-1',
  entity_type: 'DOCUMENT',
  property_definition_id: 'trip',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as const;

describe('time-range property values', () => {
  it('reads two stored UTC midnights as an all-day range of local days', () => {
    const property = entityPropertyFromApi({
      definition,
      property: assignment,
      value: {
        type: 'DateRange',
        value: { start: '2026-03-01T00:00:00Z', end: '2026-03-05T00:00:00Z' },
      },
    });

    expect(property.valueType).toBe('DATE_RANGE');
    expect(property.value).toEqual({
      allDay: true,
      start: new Date(2026, 2, 1),
      end: new Date(2026, 2, 5),
    });
  });

  it('reads other stored instants as a timed range', () => {
    const property = entityPropertyFromApi({
      definition,
      property: assignment,
      value: {
        type: 'DateRange',
        value: { start: '2026-03-01T14:00:00Z', end: '2026-03-01T22:00:00Z' },
      },
    });

    expect(property.value).toEqual({
      allDay: false,
      start: new Date('2026-03-01T14:00:00Z'),
      end: new Date('2026-03-01T22:00:00Z'),
    });
  });

  it('stores all-day ranges as UTC midnights, timed ranges as instants, and clears an empty one', () => {
    expect(
      propertyValueToApi(
        {
          valueType: 'DATE_RANGE',
          value: {
            allDay: true,
            start: new Date(2026, 2, 1),
            end: new Date(2026, 2, 5),
          },
        },
        false
      )
    ).toEqual({
      type: 'date_range',
      value: {
        start: '2026-03-01T00:00:00.000Z',
        end: '2026-03-05T00:00:00.000Z',
      },
    });
    expect(
      propertyValueToApi(
        {
          valueType: 'DATE_RANGE',
          value: {
            allDay: false,
            start: new Date('2026-03-01T14:00:00Z'),
            end: new Date('2026-03-01T22:00:00Z'),
          },
        },
        false
      )
    ).toEqual({
      type: 'date_range',
      value: {
        start: '2026-03-01T14:00:00.000Z',
        end: '2026-03-01T22:00:00.000Z',
      },
    });
    expect(
      propertyValueToApi({ valueType: 'DATE_RANGE', value: null }, false)
    ).toBeNull();
  });
});
