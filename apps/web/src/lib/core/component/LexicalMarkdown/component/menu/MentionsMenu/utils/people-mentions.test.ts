import type { EntityItem, UserItem } from '@core/context/quickAccess';
import type { CrmContactEntity } from '@entity';
import { expect, it } from 'vitest';
import { mergePeopleMentions } from './people-mentions';

const contact = (
  id: string,
  email: string,
  timestamp = 1,
  hidden = false
): EntityItem<CrmContactEntity> => ({
  kind: 'entity',
  bucket: 'crm_contact',
  id,
  sortTimestamp: timestamp,
  searchText: 'Pat',
  timestamps: {},
  data: {
    type: 'crm_contact',
    id,
    ownerId: '',
    companyId: `company-${id}`,
    email,
    name: 'Pat',
    hidden,
  },
});
const user: UserItem = {
  kind: 'user',
  bucket: 'person',
  id: 'macro|pat@example.com',
  sortTimestamp: 0,
  searchText: 'Pat',
  timestamps: {},
  data: {
    id: 'macro|pat@example.com',
    email: 'pat@example.com',
    name: 'Macro Pat',
  },
};

it('collapses full lowercased emails, keeps plus aliases, and picks a recent visible team record', () => {
  const result = mergePeopleMentions(
    [],
    [
      contact('old', 'Pat@Example.com'),
      contact('a', ' pat@example.com ', 3),
      contact('z', 'PAT@example.com', 3),
      contact('hidden', 'pat@example.com', 9, true),
      contact('plus', 'pat+alias@example.com'),
    ],
    []
  );
  expect(result.map((item) => item.id)).toEqual(['z', 'plus']);
});

it('prefers a Macro user even when only their CRM name matches the search', () => {
  expect(
    mergePeopleMentions([], [contact('crm', 'PAT@example.com')], [user])
  ).toEqual([user]);
  expect(
    mergePeopleMentions([user], [contact('crm', 'PAT@example.com')], [user])
  ).toEqual([user]);
});
