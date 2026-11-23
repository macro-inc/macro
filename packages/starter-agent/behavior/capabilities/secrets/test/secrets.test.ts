// The secrets capability against the stub vault: what the agent can do, what it is told, and that it never sees a value.
import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import {
  copySecret,
  copySecretCode,
  createSecret,
  requestSecretAccess,
  type SecretHit,
  searchSecrets,
  secretsModule,
  updateSecret,
} from '../index.ts';
import { rig, teamId } from './rig.ts';

const password = 'correct-horse-battery-staple';
const login = { username: 'ada', password };

/** What a call threw, as the agent would read it. */
const thrown = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('it did not throw');
};

const found = async (
  context: ReturnType<typeof rig>['context'],
  name: string
): Promise<SecretHit> => {
  const hit = (await searchSecrets(context, { query: name })).find(
    (each) => each.name === name
  );
  if (hit === undefined) throw new Error(`no ${name}`);
  return hit;
};

test('search finds what the team could share, with whether it is usable, and never a value', async () => {
  const { context, stub } = rig();
  const id = stub.add({
    name: 'Example login',
    kind: 'login',
    url: 'https://example.com',
    slots: login,
  });
  const hits = await searchSecrets(context, { query: 'example' });
  expect(hits).toEqual([
    {
      teamId,
      itemId: id,
      name: 'Example login',
      kind: 'login',
      url: 'https://example.com',
      access: 'request_access',
      canUpdate: false,
      version: 1,
      fields: ['username', 'password'],
    },
  ]);
  expect(JSON.stringify(hits)).not.toContain(password);
  expect(await searchSecrets(context, { query: 'nothing like it' })).toEqual(
    []
  );
});

test('what the agent creates it can copy at once, with no request', async () => {
  const { context, clipboard, stub } = rig();
  const created = await createSecret(context, {
    name: 'New service',
    kind: 'login',
    url: 'https://new.example.com',
    username: 'agent',
    password: 'made-up-password-0123456789',
  });
  expect(created.item).toMatchObject({
    name: 'New service',
    access: 'usable',
    canUpdate: true,
  });
  expect(
    await copySecret(context, { item: created.item, field: 'password' })
  ).toBe('Copied New service password');
  expect(clipboard.text).toBe('made-up-password-0123456789');
  expect(
    await copySecret(context, { item: created.item, field: 'username' })
  ).toBe('Copied New service username');
  expect(clipboard.text).toBe('agent');
  // Nothing was asked for: no request ever went to the vault.
  expect(
    stub.calls.filter(({ path }) => path.includes('access-requests'))
  ).toEqual([]);
});

test('a shared item is asked for, waits on the owner, and is usable once approved', async () => {
  const { context, stub, clipboard, polling } = rig();
  const id = stub.add({ name: 'Shared', kind: 'login', slots: login });
  const item = await found(context, 'Shared');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'you have no access to "Shared": ask your owner for it with requestSecretAccess'
  );
  expect(await requestSecretAccess(context, { item })).toBe('Requested');
  expect(polling.on).toBe(true);
  // Asking again is the same request, not a second one.
  expect(await requestSecretAccess(context, { item })).toBe('Requested');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'access to "Shared" is waiting on your owner\'s approval: you are woken when it is decided'
  );
  expect((await found(context, 'Shared')).access).toBe('pending');
  stub.owner.approve(id, 'view');
  expect(await copySecret(context, { item, field: 'password' })).toBe(
    'Copied Shared password'
  );
  expect(clipboard.text).toBe(password);
  expect(await requestSecretAccess(context, { item })).toBe('Already usable');
});

test('a grant without the first-use approval is pending', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Granted', kind: 'login', slots: login });
  stub.owner.share(id, 'view');
  const item = await found(context, 'Granted');
  expect(item.access).toBe('request_access');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain('waiting on your owner');
});

test('a team-wide share grants an agent nothing: the item is request_access', async () => {
  const { context, stub } = rig();
  stub.add({ name: 'Team item', kind: 'login', slots: login, share: 'team' });
  stub.add({
    name: 'Private item',
    kind: 'login',
    slots: login,
    share: 'private',
  });
  const hits = await searchSecrets(context, { query: 'item' });
  expect(hits.map(({ name, access }) => [name, access])).toEqual([
    ['Team item', 'request_access'],
  ]);
  const [item] = hits;
  if (item === undefined) throw new Error('no item');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain('you have no access to "Team item"');
});

test('a creator without a current grant is not granted, never pending, even once it asks', async () => {
  const { context, stub } = rig();
  const created = await createSecret(context, {
    name: 'Mine',
    kind: 'api',
    secret: 'api-key-0123456789abcdef',
  });
  stub.owner.revoke(created.item.itemId, 'grant_and_approval');
  const notGranted = 'you have no access to "Mine"';
  expect(
    await thrown(() =>
      copySecret(context, { item: created.item, field: 'secret' })
    )
  ).toContain(notGranted);
  expect(await requestSecretAccess(context, { item: created.item })).toBe(
    'Requested'
  );
  expect((await found(context, 'Mine')).access).toBe('request_access');
  expect(
    await thrown(() =>
      copySecret(context, { item: created.item, field: 'secret' })
    )
  ).toContain(notGranted);
});

test('a TOTP code is copied, never the seed', async () => {
  const { context, stub, clipboard } = rig();
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const id = stub.add({
    name: 'With code',
    kind: 'login',
    slots: login,
    totpSeed: seed,
  });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'With code');
  expect(await copySecretCode(context, { item })).toMatch(
    /^Copied code for With code, valid for about \d+ s$/
  );
  expect(clipboard.text).toMatch(/^\d{6}$/);
});

test('create and update can take the value from the clipboard, and never hand it back', async () => {
  const { context, clipboard, stub } = rig();
  clipboard.text = 'from-the-page-0123456789';
  const created = await createSecret(context, {
    name: 'From clipboard',
    kind: 'login',
    username: 'agent',
    password: { fromClipboard: true },
  });
  expect(stub.slotsOf(created.item.itemId)).toEqual({
    username: 'agent',
    password: 'from-the-page-0123456789',
    notes: '',
    fields: [],
  });
  expect(JSON.stringify(created)).not.toContain('from-the-page');

  clipboard.text = 'rotated-0123456789abcdef';
  const updated = await updateSecret(context, {
    item: created.item,
    password: { fromClipboard: true },
  });
  expect(updated.version).toBe(created.version + 1);
  expect(stub.slotsOf(created.item.itemId)).toMatchObject({
    password: 'rotated-0123456789abcdef',
  });
  expect(JSON.stringify(updated)).not.toContain('rotated');

  // The item each call hands back carries its new version, so it can be changed again.
  const renamed = await updateSecret(context, {
    item: updated.item,
    name: 'Renamed',
  });
  expect(renamed.item.name).toBe('Renamed');
  expect(renamed.item.version).toBe(updated.version + 1);
});

test('a search hit carries its version, which an update and a copy send, and a changed item is a conflict', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Viewable', kind: 'login', slots: login });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'Viewable');
  expect(item.version).toBe(1);
  expect(
    await thrown(() =>
      updateSecret(context, { item, password: 'new-0123456789abc' })
    )
  ).toBe('you may not change "Viewable"');
  stub.owner.approve(id, 'edit');
  const updated = await updateSecret(context, {
    item,
    password: 'new-0123456789abc',
  });
  expect(updated.version).toBe(2);
  const updates = stub.calls.filter(({ method }) => method === 'PATCH');
  expect(JSON.parse(updates.at(-1)?.body ?? '{}')).toMatchObject({
    expectedVersion: 1,
  });
  // The hit from before the update is stale now.
  const changed = 'changed since you last saw it: search for it again';
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain(changed);
  expect(
    await thrown(() => updateSecret(context, { item, name: 'Again' }))
  ).toContain(changed);
  expect(
    await copySecret(context, { item: updated.item, field: 'password' })
  ).toBe('Copied Viewable password');
  // An item handed over without its version must be looked up first.
  const { version: _, ...unversioned } = item;
  expect(
    await thrown(() => updateSecret(context, { item: unversioned, name: 'X' }))
  ).toContain('search for "Viewable" first');
});

test("with the flag off, team calls say secrets aren't turned on; item calls can't tell that from a missing item", async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Here', kind: 'login', slots: login });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'Here');
  stub.flags.enabled = false;
  expect(await thrown(() => searchSecrets(context, {}))).toBe(
    "secrets aren't turned on for this team"
  );
  expect(
    await thrown(() =>
      createSecret(context, { name: 'X', kind: 'api', secret: 'text' })
    )
  ).toBe("secrets aren't turned on for this team");
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'no secret "Here" in your team\'s vault, or secrets aren\'t turned on for this team'
  );
});

test('input a type cannot rule out is refused with a clear error', async () => {
  const { context, stub } = rig();
  stub.add({ name: 'Note', kind: 'note', slots: { notes: 't' } });
  stub.add({ name: 'Login', kind: 'login', slots: login });
  const note = await found(context, 'Note');
  const item = await found(context, 'Login');
  expect(note.fields).toEqual([]);
  const before = stub.calls.length;
  expect(
    await thrown(() => copySecret(context, { item: note, field: 'password' }))
  ).toBe("you can't copy from a note: only logins and API credentials");
  // The field is checked against the hit's kind, before anything is asked.
  expect(await thrown(() => copySecret(context, { item, field: 'key' }))).toBe(
    'a login has no key: its fields are username, password'
  );
  expect(stub.calls.length).toBe(before);
  for (const input of [
    { name: 'X', kind: 'login' },
    { name: ' ', kind: 'login', password: 'v' },
    { name: 'X', kind: 'login', password: '' },
    {
      name: 'X',
      kind: 'login',
      username: { fromClipboard: true },
      password: { fromClipboard: true },
    },
  ]) {
    const refused = await invoke(secretsModule, 'createSecret', context, input);
    expect(refused.kind).not.toBe('succeeded');
  }
  expect(await thrown(() => updateSecret(context, { item }))).toBe(
    'nothing to change: give username, password, name or url'
  );
  expect(await thrown(() => updateSecret(context, { item, secret: 'x' }))).toBe(
    'a login has no secret: its fields are username, password'
  );
  expect(
    await thrown(() => updateSecret(context, { item, username: '' }))
  ).toBe("username: empty (a field can't be cleared)");
  // A kind the agent can't create, or a field of another kind, doesn't type-check.
  for (const input of [
    { name: 'Card', kind: 'card', password: 'v' },
    { name: 'Api', kind: 'api', password: 'v' },
  ]) {
    const refused = await invoke(secretsModule, 'createSecret', context, input);
    expect(refused.kind).toBe('invalid');
  }
});

test('an API credential copies its key and secret by the api selector', async () => {
  const { context, stub, clipboard } = rig();
  const id = stub.add({
    name: 'Api',
    kind: 'api',
    slots: { username: 'key-id-0123', password: 'secret-0123456789' },
  });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'Api');
  expect(item.fields).toEqual(['key', 'secret']);
  expect(await copySecret(context, { item, field: 'key' })).toBe(
    'Copied Api key'
  );
  expect(clipboard.text).toBe('key-id-0123');
  expect(await copySecret(context, { item, field: 'secret' })).toBe(
    'Copied Api secret'
  );
  expect(clipboard.text).toBe('secret-0123456789');
  const selectors = stub.calls
    .filter(({ path }) => path.endsWith('/disclose'))
    .map(({ body }) => JSON.parse(body).selector);
  expect(selectors).toEqual([
    { kind: 'api', field: 'key' },
    { kind: 'api', field: 'secret' },
  ]);
});

test('a field the item has no value in is said so, not offered as a retry', async () => {
  const { context, stub, clipboard } = rig();
  const id = stub.add({
    name: 'No username',
    kind: 'login',
    slots: { password },
  });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'No username');
  expect(
    await thrown(() => copySecret(context, { item, field: 'username' }))
  ).toBe('"No username" has no username');
  expect(clipboard.text).toBeUndefined();
});

test('an item whose kind the vault no longer lets agents use is unsupported', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Card', kind: 'card', slots: { password } });
  stub.owner.approve(id, 'view');
  const card = await found(context, 'Card');
  // A caller that hands over a stale kind still hears what the vault said.
  expect(
    await thrown(() =>
      copySecret(context, {
        item: { ...card, kind: 'login' },
        field: 'password',
      })
    )
  ).toBe('agents can\'t use "Card": only logins and API credentials');
});

test('an update sends a typed patch and metadata, and keeps the notes and custom fields', async () => {
  const { context, stub } = rig();
  const created = await createSecret(context, {
    name: 'Api',
    kind: 'api',
    key: 'key-0123',
    secret: 'secret-0123456789',
  });
  const id = created.item.itemId;
  const before = stub.slotsOf(id);
  if (before === undefined) throw new Error('no item');
  before.notes = 'kept notes';
  before.fields = [{ label: 'Region', value: 'eu' }];
  await updateSecret(context, {
    item: created.item,
    secret: 'rotated-0123456789',
    name: 'Api (rotated)',
    url: 'https://api.example.com',
  });
  const patch = stub.calls.find(({ method }) => method === 'PATCH');
  const sent = JSON.parse(patch?.body ?? '{}');
  expect(sent).toEqual({
    operationId: sent.operationId,
    expectedVersion: created.version,
    secretPatch: { kind: 'api', secret: 'rotated-0123456789' },
    metadataPatch: { name: 'Api (rotated)', url: 'https://api.example.com' },
  });
  expect(stub.slotsOf(id)).toEqual({
    username: 'key-0123',
    password: 'rotated-0123456789',
    notes: 'kept notes',
    fields: [{ label: 'Region', value: 'eu' }],
  });
});

test('asking again too soon after a denial says when it may ask again', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Shared', kind: 'login', slots: login });
  const item = await found(context, 'Shared');
  await requestSecretAccess(context, { item });
  stub.owner.deny(id);
  expect(await thrown(() => requestSecretAccess(context, { item }))).toBe(
    'you have asked for access too often: you can ask for "Shared" again in about 60 min'
  );
});

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const withCode = async () => {
  const setup = rig();
  const id = setup.stub.add({
    name: 'With code',
    kind: 'login',
    slots: login,
    totpSeed: seed,
  });
  setup.stub.owner.approve(id, 'view');
  return { ...setup, item: await found(setup.context, 'With code') };
};

test('a code is held on the clipboard for no longer than it has left, less three seconds', async () => {
  const { context, stub, pasted, item } = await withCode();
  stub.flags.validForMs = [12_000];
  stub.flags.latencyMs = 1_000;
  expect(await copySecretCode(context, { item })).toBe(
    'Copied code for With code, valid for about 8 s'
  );
  // 12 s left when the vault answered, 1 s gone since the request was sent, 3 s to spare.
  expect(pasted.at(-1)?.ttlMs).toBe(8_000);
  stub.flags.validForMs = [60_000];
  stub.flags.latencyMs = 0;
  await copySecretCode(context, { item });
  expect(pasted.at(-1)?.ttlMs).toBe(20_000);
});

test('a code with under three seconds left is asked for once more, timed from the first request', async () => {
  const { context, stub, pasted, item } = await withCode();
  stub.flags.validForMs = [3_500, 25_000];
  stub.flags.latencyMs = 1_000;
  expect(await copySecretCode(context, { item })).toBe(
    'Copied code for With code, valid for about 20 s'
  );
  expect(
    stub.calls.filter(({ path }) => path.endsWith('/totp/code'))
  ).toHaveLength(2);
  // Two seconds gone since the first request, so 25 - 2 - 3 = 20 s.
  expect(pasted).toHaveLength(1);
  expect(pasted[0]?.ttlMs).toBe(20_000);
});

test('a code that is still too close to its end after one retry is not copied', async () => {
  const { context, stub, pasted, clipboard, item } = await withCode();
  stub.flags.validForMs = [3_500, 4_000];
  stub.flags.latencyMs = 1_000;
  expect(await thrown(() => copySecretCode(context, { item }))).toBe(
    'the code for "With code" was too close to expiring to paste: try again'
  );
  expect(pasted).toEqual([]);
  expect(clipboard.text).toBeUndefined();
});

test('a secret value never appears in anything a function returns, logs, writes or throws', async () => {
  const { context, stub, disk, clipboard } = rig();
  const sentinel = 'SENTINEL-secret-value-9f8e7d6c';
  const outputs: unknown[] = [];
  const record = async (run: () => Promise<unknown>) => {
    try {
      outputs.push(await run());
    } catch (error) {
      outputs.push(error instanceof Error ? error.message : error);
    }
  };
  const id = stub.add({
    name: 'Guarded',
    kind: 'login',
    slots: { username: sentinel, password: sentinel },
    totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  });
  const item = await found(context, 'Guarded');
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => requestSecretAccess(context, { item }));
  stub.owner.approve(id, 'edit');
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => copySecret(context, { item, field: 'username' }));
  await record(() => copySecretCode(context, { item }));
  await record(() => updateSecret(context, { item, password: sentinel }));
  clipboard.text = sentinel;
  await record(() =>
    createSecret(context, {
      name: 'Also',
      kind: 'login',
      password: { fromClipboard: true },
    })
  );
  await record(() =>
    updateSecret(context, {
      item: { ...item, version: 99 },
      password: { fromClipboard: true },
    })
  );
  stub.flags.busy = 10;
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => searchSecrets(context, { query: 'Guarded' }));
  // The value did reach the clipboard and the vault, and nothing else.
  expect(outputs).toHaveLength(10);
  expect(JSON.stringify(outputs)).not.toContain(sentinel);
  expect(JSON.stringify([...disk.files.entries()])).not.toContain(sentinel);
  expect(disk.files.size).toBeGreaterThan(0);
});
