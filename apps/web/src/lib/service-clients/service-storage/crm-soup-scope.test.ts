import { crmProtectedQueryKey } from '@queries/crm-cache-scope';
import { soupKeys } from '@queries/soup/keys';
import { afterEach, describe, expect, it } from 'vitest';
import { crmAccessAuthority } from './crm-access-authority';
import { crmResponseScope } from './crm-response-scope';
import { beginRestSoupPage, restSoupNeedsCrmProof } from './crm-soup-scope';

const NIL = '00000000-0000-0000-0000-000000000000';
const personal = { ccf: { l: { id: NIL } }, ef: { '!': { l: { id: NIL } } } };
const endpoint = 'http://localhost/items/soup/ast';
afterEach(() => crmAccessAuthority.setSession(undefined));

describe('personal REST Soup scope', () => {
  it.each(['spam', 'trash'])(
    'admits the initial %s page without CRM proof',
    async (emailView) => {
      const body = { ...personal, emailView };
      expect(
        await crmResponseScope('storage', '/items/soup/ast', endpoint, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).toEqual({ protected: false, write: false });
      expect(
        crmProtectedQueryKey(
          soupKeys.astItems({ params: {}, body, transport: 'rest' }).queryKey
        )
      ).toBe(false);
    }
  );

  it.each([
    {},
    { ...personal, ccf: undefined },
    { ...personal, ccf: { '!': { l: { id: NIL } } } },
    {
      ...personal,
      ccf: { '|': [{ l: { id: NIL } }, { l: { hidden: false } }] },
    },
    { ...personal, crmf: { l: 'include' } },
    { ...personal, crma: { company: 'company' } },
    { ...personal, eca: ['person@example.com'] },
    { ...personal, ecd: ['example.com'] },
  ])('keeps CRM-capable filters protected: %j', async (body) => {
    expect(
      await crmResponseScope('storage', '/items/soup/ast', endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).toEqual({ protected: true, write: false });
  });

  it('does not infer an opaque continuation scope from the replacement body', async () => {
    expect(
      await crmResponseScope(
        'storage',
        '/items/soup/ast',
        `${endpoint}?cursor=unknown`,
        { method: 'POST', body: JSON.stringify(personal) }
      )
    ).toEqual({ protected: true, write: false });
  });

  it.each(['/items/soup', '/items/soup/ast/grouped'])(
    'does not extend flat AST admission to %s',
    async (path) => {
      expect(
        await crmResponseScope('storage', path, `http://localhost${path}`, {
          method: 'POST',
          body: JSON.stringify(personal),
        })
      ).toEqual({ protected: true, write: false });
    }
  );

  it('keeps grouped persistence protected despite an independent flat body', () => {
    expect(
      crmProtectedQueryKey(
        soupKeys.astItems({
          params: {},
          body: personal,
          transport: 'rest',
          groupBy: { type: 'date' },
        }).queryKey
      )
    ).toBe(true);
  });

  it('rejects malformed and deeply nested filters without losing bounded positive exclusions', () => {
    expect(restSoupNeedsCrmProof('{', null)).toBe(true);
    const other = { l: { hidden: false } };
    const excluded = { l: { id: NIL } };
    expect(
      restSoupNeedsCrmProof(
        JSON.stringify({ ...personal, ccf: { '&': [other, excluded] } }),
        null
      )
    ).toBe(false);
    let ccf: unknown = excluded;
    for (let depth = 0; depth < 66; depth++) ccf = { '&': [other, ccf] };
    expect(
      restSoupNeedsCrmProof(JSON.stringify({ ...personal, ccf }), null)
    ).toBe(true);
  });

  it('carries only an admitted parent scope through successive pages', () => {
    crmAccessAuthority.setSession('viewer');
    const body = JSON.stringify({ ...personal, emailView: 'spam' });
    const first = beginRestSoupPage(body, null);
    expect(restSoupNeedsCrmProof(body, 'page-two')).toBe(true);
    first('page-two');
    expect(restSoupNeedsCrmProof(body, 'page-two')).toBe(false);
    beginRestSoupPage(body, 'page-two')('page-three');
    expect(restSoupNeedsCrmProof(body, 'page-three')).toBe(false);
    expect(
      restSoupNeedsCrmProof(
        JSON.stringify({ ...personal, emailView: 'trash' }),
        'page-three'
      )
    ).toBe(true);
  });

  it.each(['viewer', 'replacement'])(
    'retires cursor witnesses and late parents after signing in as %s',
    (account) => {
      crmAccessAuthority.setSession('viewer');
      const body = JSON.stringify(personal);
      const accept = beginRestSoupPage(body, null);
      accept('previous-page');
      expect(restSoupNeedsCrmProof(body, 'previous-page')).toBe(false);
      crmAccessAuthority.setSession(account, 1);
      accept('late-page');
      expect(restSoupNeedsCrmProof(body, 'previous-page')).toBe(true);
      expect(restSoupNeedsCrmProof(body, 'late-page')).toBe(true);
    }
  );

  it('never promotes an unknown or CRM-scoped parent to an independent continuation', () => {
    crmAccessAuthority.setSession('viewer');
    const body = JSON.stringify(personal);
    beginRestSoupPage(body, 'unknown-parent')('unknown-child');
    beginRestSoupPage('{}', null)('crm-child');
    expect(restSoupNeedsCrmProof(body, 'unknown-child')).toBe(true);
    expect(restSoupNeedsCrmProof('{}', 'crm-child')).toBe(true);
    expect(restSoupNeedsCrmProof(body, 'crm-child')).toBe(true);
  });

  it('bounds retained cursor witnesses', () => {
    crmAccessAuthority.setSession('viewer');
    const body = JSON.stringify(personal);
    const accept = beginRestSoupPage(body, null);
    for (let index = 0; index < 129; index++) accept(`bounded-page-${index}`);
    expect(restSoupNeedsCrmProof(body, 'bounded-page-0')).toBe(true);
    expect(restSoupNeedsCrmProof(body, 'bounded-page-128')).toBe(false);
  });

  it('retains an admitted in-flight parent through idle witness eviction', () => {
    crmAccessAuthority.setSession('viewer');
    const body = JSON.stringify(personal);
    const accept = beginRestSoupPage(body, null);
    accept('in-flight-parent');
    const next = beginRestSoupPage(body, 'in-flight-parent');
    for (let index = 0; index < 128; index++) accept(`eviction-${index}`);
    expect(restSoupNeedsCrmProof(body, 'in-flight-parent')).toBe(true);
    next('in-flight-child');
    expect(restSoupNeedsCrmProof(body, 'in-flight-child')).toBe(false);
  });

  it('classifies a Request body without consuming it', async () => {
    const request = new Request(endpoint, {
      method: 'POST',
      body: JSON.stringify(personal),
    });
    expect(
      await crmResponseScope('storage', '/items/soup/ast', request, {})
    ).toEqual({ protected: false, write: false });
    expect(request.bodyUsed).toBe(false);
  });
});
