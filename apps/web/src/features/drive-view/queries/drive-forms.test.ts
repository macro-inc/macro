import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { hiddenFormDatabases, selectDriveForms } from './drive-forms';

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'updated_at',
  search: '',
  facets: {},
};
const listed: ListedForm[] = [
  {
    form: {
      id: 'rsvp',
      name: 'Offsite RSVP',
      description: '',
      ownerId: 'me',
      databaseId: 'rsvp-database',
      tableId: 'rsvp-table',
      submittedColumnId: null,
      respondentColumnId: null,
      audience: 'members',
      tallyVisible: false,
      responsesVisible: false,
      respondentHidden: false,
      status: 'open',
      closesAt: null,
      confirmationMessage: '',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      isHiddenInDrive: false,
    },
    access: 'owner',
  },
  {
    form: {
      id: 'poll',
      name: 'Lunch?',
      description: '',
      ownerId: 'me',
      databaseId: 'poll-database',
      tableId: 'poll-table',
      submittedColumnId: null,
      respondentColumnId: null,
      audience: 'members',
      tallyVisible: true,
      responsesVisible: false,
      respondentHidden: false,
      status: 'open',
      closesAt: null,
      confirmationMessage: '',
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
      isHiddenInDrive: true,
    },
    access: 'owner',
  },
];

describe('Drive form listing', () => {
  it('leaves out a form kept out of Drive, and the database made for it', () => {
    expect(
      selectDriveForms(listed, selection, 'me').map((entity) => entity.id)
    ).toEqual(['rsvp']);
    expect(hiddenFormDatabases(listed)).toEqual(new Set(['poll-database']));
  });
});
