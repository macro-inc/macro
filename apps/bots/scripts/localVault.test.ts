import { expect, test } from 'bun:test';
import { isVaultPatch, isVaultWrite, vaultOperation } from './localVault';

const uuid = '0193a1b2-0000-7000-8000-000000000021';

test('vault transport exposes only exact catalog and canonical item verbs', () => {
  const root = '/local';
  const catalog = `${root}/vault/items`;
  expect(vaultOperation({ method: 'GET', url: catalog }, root)).toEqual({
    method: 'GET',
  });
  expect(
    vaultOperation({ method: 'PATCH', url: `${catalog}/${uuid}` }, root)
  ).toEqual({ method: 'PATCH', item: uuid });

  for (const request of [
    { method: 'DELETE', url: `${catalog}/${uuid}` },
    { method: 'GET', url: `${catalog}?team=${uuid}` },
    { method: 'GET', url: `${catalog}/${uuid.toUpperCase()}` },
    { method: 'POST', url: `${catalog}/${uuid}/reveal` },
    { method: 'PUT', url: catalog },
  ]) {
    expect(vaultOperation(request, root)).toBeUndefined();
  }
});

test('write contracts bind mutation intent and reject caller-authored scope', () => {
  const metadata = { name: 'Synthetic note', kind: 'note', favorite: false };
  const write = {
    ...metadata,
    operationId: uuid,
    private: true,
    values: { username: '', password: '', notes: '', fields: [] },
  };
  expect(isVaultWrite(write, 'POST')).toBe(true);
  expect(isVaultWrite(write, 'PUT')).toBe(false);
  expect(isVaultWrite({ ...write, expectedVersion: 1 }, 'PUT')).toBe(true);
  expect(isVaultWrite({ ...write, teamId: uuid }, 'POST')).toBe(false);
  expect(isVaultWrite({ ...write, private: false }, 'POST')).toBe(false);
  expect(isVaultWrite({ ...write, kind: 'card' }, 'POST')).toBe(false);
  expect(isVaultPatch({ ...metadata, expectedVersion: 1 })).toBe(true);
  expect(isVaultPatch({ ...write, expectedVersion: 1 })).toBe(false);
});
