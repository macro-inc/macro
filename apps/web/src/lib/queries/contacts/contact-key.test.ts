import { expect, it } from 'vitest';
import fixtures from '../../../../../../crates/comms/contacts_core/src/models/contact/identity-fixtures.json';
import { contactRecordKey } from './contact-key';

it('derives only the requested viewer-scoped keys using the backend identity contract', () => {
  for (const fixture of fixtures)
    expect(contactRecordKey(fixture.viewer, fixture.user)).toBe(
      `GraphqlContact:${fixture.id}`
    );
  expect(contactRecordKey(fixtures[0].viewer, fixtures[0].user)).not.toBe(
    contactRecordKey(fixtures[1].viewer, fixtures[1].user)
  );
});
