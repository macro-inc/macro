import { describe, expect, it } from 'vitest';
import { contactCompanyName, contactCompanySummary } from './contact';

describe('contactCompanySummary', () => {
  const company = { id: 'company-1', name: 'Acme', hidden: false };

  it('returns the summary of the current company', () => {
    expect(contactCompanySummary({ companyId: 'company-1', company })).toBe(
      company
    );
  });

  it('asks for a read when the response has no summary', () => {
    expect(contactCompanySummary({ companyId: 'company-1' })).toBeUndefined();
    expect(
      contactCompanySummary({ companyId: 'company-1', company: null })
    ).toBeUndefined();
    expect(contactCompanySummary(undefined)).toBeUndefined();
  });

  it('drops a summary of a company the contact has left', () => {
    expect(
      contactCompanySummary({ companyId: 'company-2', company })
    ).toBeUndefined();
    expect(contactCompanySummary({ companyId: null, company })).toBeUndefined();
  });
});

describe('contactCompanyName', () => {
  it('names an unnamed company by its domain, as the company read does', () => {
    expect(
      contactCompanyName({
        id: 'company-1',
        name: 'Acme',
        domain: 'acme.com',
        hidden: false,
      })
    ).toBe('Acme');
    expect(
      contactCompanyName({
        id: 'company-1',
        name: null,
        domain: 'acme.com',
        hidden: false,
      })
    ).toBe('acme.com');
    expect(contactCompanyName({ id: 'company-1', hidden: false })).toBe('');
  });
});
