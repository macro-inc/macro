import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { describe, expect, it } from 'vitest';
import {
  recordCallsBody,
  recordFilesBody,
  recordListFailure,
  recordReferencesBody,
} from './record-items';

describe('CRM record item queries', () => {
  it('lists non-task files associated with a company or attached to emails with its domains', () => {
    const body = recordFilesBody({
      type: 'company',
      id: 'company-1',
      domains: ['acme.com', 'acme.io'],
    });

    expect(body.df).toEqual({
      '&': [
        { '!': { l: { dst: 'task' } } },
        {
          '|': [
            {
              '|': [
                { l: { crm: { company: 'company-1' } } },
                { l: { eap: { Domain: 'acme.com' } } },
              ],
            },
            { l: { eap: { Domain: 'acme.io' } } },
          ],
        },
      ],
    });
    expect(body).not.toHaveProperty('crma');
    expect(body.callf).toEqual({ l: { CallId: NIL_UUID } });
    expect(body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
  });

  it('matches a contact through its association or its exact address', () => {
    const body = recordFilesBody({
      type: 'contact',
      id: 'contact-1',
      email: 'ada@acme.com',
      companyId: 'company-1',
    });

    expect(body.df['&'][1]).toEqual({
      '|': [
        { l: { crm: { contact: 'contact-1' } } },
        { l: { eap: { Complete: 'ada@acme.com' } } },
      ],
    });
  });

  it('lists only calls associated with the record', () => {
    const body = recordCallsBody({
      type: 'company',
      id: 'company-1',
      domains: ['acme.com'],
    });

    expect(body).not.toHaveProperty('callf');
    expect(body).not.toHaveProperty('propf');
    expect(body.crma).toEqual({ company: 'company-1' });
    expect(body.df).toEqual({ l: { id: NIL_UUID } });
    expect(body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
  });

  it('lists every associated item for references, including other CRM records', () => {
    expect(
      recordReferencesBody({
        type: 'contact',
        id: 'contact-1',
        email: 'ada@acme.com',
        companyId: 'company-1',
      })
    ).toEqual({
      crma: { contact: 'contact-1' },
      crmf: { l: 'include' },
      emailView: 'all',
    });
  });

  it('keeps loaded rows only when a continuation page failed', () => {
    const error = new Error('CRM record not found');
    expect(recordListFailure({ error, isFetchNextPageError: false })).toEqual({
      isError: true,
      isFetchNextPageError: false,
    });
    expect(recordListFailure({ error, isFetchNextPageError: true })).toEqual({
      isError: false,
      isFetchNextPageError: true,
    });
    expect(
      recordListFailure({ error: null, isFetchNextPageError: false })
    ).toEqual({ isError: false, isFetchNextPageError: false });
  });
});
