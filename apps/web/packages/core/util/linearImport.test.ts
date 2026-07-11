import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { describe, expect, test } from 'vitest';
import { linearCsvRecordToMacroTaskDraft } from './linearImport';

describe('linearCsvRecordToMacroTaskDraft', () => {
  test('maps Completed timestamp to completed status', () => {
    const draft = linearCsvRecordToMacroTaskDraft({
      record: {
        Title: 'A',
        Completed: '2025-01-01',
        Status: 'In Progress',
      },
      assigneeUserId: null,
    });

    const status = draft.propertyValues.find(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.STATUS
    );
    expect(status).toBeTruthy();
    expect(status?.value).toEqual({
      type: 'select_option',
      option_id: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    });
  });

  test('maps Archived timestamp to canceled status (best available option)', () => {
    const draft = linearCsvRecordToMacroTaskDraft({
      record: {
        Title: 'A',
        Archived: '2025-01-02',
        Status: 'Done',
      },
      assigneeUserId: null,
    });

    const status = draft.propertyValues.find(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.STATUS
    );
    expect(status?.value).toEqual({
      type: 'select_option',
      option_id: PROPERTY_OPTION_IDS.STATUS.CANCELED,
    });

    expect(draft.content).toContain('Linear Archived: 2025-01-02');
  });

  test('maps priority strings', () => {
    const draft = linearCsvRecordToMacroTaskDraft({
      record: {
        Title: 'A',
        Priority: 'Urgent',
      },
      assigneeUserId: null,
    });
    const priority = draft.propertyValues.find(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.PRIORITY
    );
    expect(priority?.value).toEqual({
      type: 'select_option',
      option_id: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
    });
  });

  test('maps priority numeric values', () => {
    const draft = linearCsvRecordToMacroTaskDraft({
      record: {
        Title: 'A',
        Priority: '2',
      },
      assigneeUserId: null,
    });
    const priority = draft.propertyValues.find(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.PRIORITY
    );
    expect(priority?.value).toEqual({
      type: 'select_option',
      option_id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
    });
  });
});
