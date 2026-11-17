import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { missingStageFields, requiredStageFields } from './stage-requirements';

const columns: DatabaseViewColumn[] = [
  {
    id: 'stage',
    name: 'Milestone',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    writable: true,
    options: [{ id: 'negotiation', label: 'New label', color: null }],
  },
  {
    id: 'amount',
    name: 'Renamed amount',
    dataType: 'NUMBER',
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'checked',
    name: 'Approval',
    dataType: 'BOOLEAN',
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'notes',
    name: 'Notes',
    dataType: 'STRING',
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'people',
    name: 'Owners',
    dataType: 'ENTITY',
    isMultiSelect: true,
    writable: true,
    options: [],
  },
];
describe('stage requirement drafts', () => {
  it('keeps identity through field and stage renames and ignores deleted fields', () => {
    const rules = [
      {
        columnId: 'stage',
        optionId: 'negotiation',
        fields: ['amount', 'deleted'],
      },
    ];
    expect(requiredStageFields(columns, rules, { stage: 'New label' })).toEqual(
      [columns[1]]
    );
    expect(requiredStageFields(columns, rules, { stage: null })).toEqual([]);
  });
  it('distinguishes absent values from zero and false', () => {
    expect(
      missingStageFields(columns.slice(1), {
        amount: 0,
        checked: 0,
        notes: '  ',
        people: '[]',
      }).map((column) => column.id)
    ).toEqual(['notes', 'people']);
    expect(
      missingStageFields(columns.slice(1), {
        amount: 0,
        checked: 0,
        notes: 'A note',
        people: '["person"]',
      })
    ).toEqual([]);
  });
});
