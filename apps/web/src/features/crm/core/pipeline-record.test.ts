import { describe, expect, it } from 'vitest';
import {
  contactCompany,
  newRecordChoice,
  recordChoiceProblem,
  recordDetail,
} from './pipeline-record';

const companies = [{ id: 'acme', domain: 'Acme.com' }];

describe('newRecordChoice', () => {
  it('puts a searched domain in the domain and names the company after it', () => {
    expect(newRecordChoice('company', ' Acme.com ')).toEqual({
      kind: 'new-company',
      name: 'Acme',
      domain: 'acme.com',
    });
  });

  it('takes any other company search as the name', () => {
    expect(newRecordChoice('company', 'Acme Corp')).toEqual({
      kind: 'new-company',
      name: 'Acme Corp',
      domain: '',
    });
  });

  it('puts a searched email in the email and anything else in the name', () => {
    expect(newRecordChoice('contact', 'Jane@Acme.com')).toEqual({
      kind: 'new-contact',
      name: '',
      email: 'jane@acme.com',
    });
    expect(newRecordChoice('contact', 'Jane Doe')).toEqual({
      kind: 'new-contact',
      name: 'Jane Doe',
      email: '',
    });
  });
});

describe('contactCompany', () => {
  it("finds the company by the email's domain", () => {
    expect(contactCompany(' JANE@acme.com', companies)).toEqual(companies[0]);
    expect(contactCompany('jane@other.com', companies)).toBeUndefined();
    expect(contactCompany('not an email', companies)).toBeUndefined();
  });
});

describe('recordChoiceProblem', () => {
  it('accepts an existing record as is', () => {
    expect(
      recordChoiceProblem(
        { kind: 'existing', record: { id: 'acme', name: '', detail: '' } },
        []
      )
    ).toBeUndefined();
  });

  it('requires a company name and validates a supplied domain', () => {
    expect(
      recordChoiceProblem(
        { kind: 'new-company', name: ' ', domain: 'acme.com' },
        []
      )
    ).toBe('Enter a company name');
    expect(
      recordChoiceProblem(
        { kind: 'new-company', name: 'Acme', domain: 'https://acme' },
        []
      )
    ).toBe('Enter a valid domain like acme.com');
    expect(
      recordChoiceProblem(
        { kind: 'new-company', name: 'Acme', domain: 'acme.com' },
        []
      )
    ).toBeUndefined();
  });

  it('asks a new contact for a name and an email at a known company', () => {
    expect(
      recordChoiceProblem(
        { kind: 'new-contact', name: '', email: 'jane@acme.com' },
        companies
      )
    ).toBe('Enter a name');
    expect(
      recordChoiceProblem(
        { kind: 'new-contact', name: 'Jane', email: 'jane' },
        companies
      )
    ).toBe('Enter an email like jane@acme.com');
    expect(
      recordChoiceProblem(
        { kind: 'new-contact', name: 'Jane', email: 'jane@Other.com' },
        companies
      )
    ).toBe('Choose a company for this contact');
    expect(
      recordChoiceProblem(
        { kind: 'new-contact', name: 'Jane', email: 'jane@acme.com' },
        companies
      )
    ).toBeUndefined();
  });
});

describe('recordDetail', () => {
  it('hides a detail that repeats the name', () => {
    expect(
      recordDetail({
        id: 'n',
        name: '43north.studio',
        detail: '43North.Studio ',
      })
    ).toBe('');
  });

  it('keeps a detail that adds to the name', () => {
    expect(
      recordDetail({ id: 'g', name: 'Globex', detail: 'globex.com' })
    ).toBe('globex.com');
  });
});

it('accepts name-only companies and explicit cross-domain contact links', () => {
  expect(
    recordChoiceProblem({ kind: 'new-company', name: 'Acme', domain: '' }, [])
  ).toBeUndefined();
  expect(
    recordChoiceProblem(
      {
        kind: 'new-contact',
        name: 'Jane',
        email: 'jane@gmail.com',
        companyId: 'acme',
      },
      [{ id: 'acme' }]
    )
  ).toBeUndefined();
  expect(
    recordChoiceProblem(
      {
        kind: 'new-contact',
        name: 'Jane',
        email: 'jane@gmail.com',
        companyId: 'missing',
      },
      [{ id: 'acme' }]
    )
  ).toBe('Choose a company for this contact');
});
