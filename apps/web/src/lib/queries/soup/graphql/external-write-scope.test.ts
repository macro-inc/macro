import { expect, it } from 'vitest';
import { crmExternalWriteTypes } from './external-write-scope';

it('does not fence explicitly excluded companies or non-opted-in contacts', () => {
  expect(
    crmExternalWriteTypes({
      crmCompanyFilter: {
        and: {
          left: { literal: { hidden: false } },
          right: { literal: { id: '00000000-0000-0000-0000-000000000000' } },
        },
      },
    })
  ).toEqual([]);
});

it('retains a CRM dependency when either OR branch can return records', () => {
  expect(
    crmExternalWriteTypes({
      crmCompanyFilter: {
        or: {
          left: { literal: { hidden: false } },
          right: { literal: { id: '00000000-0000-0000-0000-000000000000' } },
        },
      },
      crmContactFilter: {
        literal: { id: '00000000-0000-0000-0000-000000000000' },
      },
    })
  ).toEqual(['GraphqlSoupCrmCompany']);
});
