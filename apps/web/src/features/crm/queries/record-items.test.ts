import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { describe, expect, it } from 'vitest';
import { recordCallsBody, recordFilesBody } from './record-items';

const COMPANIES = '00000001-0000-0000-0000-00000000000c';
const CONTACTS = '00000001-0000-0000-0000-000000000013';

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
                { l: { prop: { pd: COMPANIES, v: { er: 'company-1' } } } },
                { l: { eap: { Domain: 'acme.com' } } },
              ],
            },
            { l: { eap: { Domain: 'acme.io' } } },
          ],
        },
      ],
    });
    expect(body.callf).toEqual({ l: { CallId: NIL_UUID } });
    expect(body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
  });

  it('matches a contact by its exact address', () => {
    const body = recordFilesBody({
      type: 'contact',
      id: 'contact-1',
      email: 'ada@acme.com',
      companyId: 'company-1',
    });

    expect(body.df['&'][1]).toEqual({
      '|': [
        { l: { prop: { pd: CONTACTS, v: { er: 'contact-1' } } } },
        { l: { eap: { Complete: 'ada@acme.com' } } },
      ],
    });
  });

  it('lists only calls, through the record property', () => {
    const body = recordCallsBody({
      type: 'company',
      id: 'company-1',
      domains: ['acme.com'],
    });

    expect(body).not.toHaveProperty('callf');
    expect(body.propf).toEqual({
      l: { pd: COMPANIES, v: { er: 'company-1' } },
    });
    expect(body.df).toEqual({ l: { id: NIL_UUID } });
    expect(body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
  });
});
