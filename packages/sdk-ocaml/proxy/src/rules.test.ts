import { describe, expect, test } from 'bun:test';
import type { OperationsFile } from './operations';
import { permissionsHandler } from './permissions';
import { Policy } from './rules';

const OPERATIONS: OperationsFile = {
  operations: [
    {
      name: 'storage.create_document',
      service: 'storage',
      operationId: 'create_document',
      method: 'POST',
      path: '/documents',
      group: 'documents',
      action: 'create',
      headers: [],
    },
    {
      name: 'storage.get_document',
      service: 'storage',
      operationId: 'get_document',
      method: 'GET',
      path: '/documents/{document_id}',
      group: 'documents',
      action: 'read',
      headers: [],
    },
    {
      name: 'storage.edit_document',
      service: 'storage',
      operationId: 'edit_document',
      method: 'POST',
      path: '/documents/{document_id}/edit',
      group: 'documents',
      action: 'update',
      headers: [],
    },
    {
      name: 'storage.delete_document',
      service: 'storage',
      operationId: 'delete_document',
      method: 'DELETE',
      path: '/documents/{document_id}',
      group: 'documents',
      action: 'destroy',
      headers: [],
    },
    {
      name: 'email.send_message',
      service: 'email',
      operationId: 'send_message',
      method: 'POST',
      path: '/email/messages/{message_id}/send',
      group: 'email',
      action: 'send',
      headers: [],
    },
    {
      name: 'email.get_message',
      service: 'email',
      operationId: 'get_message',
      method: 'GET',
      path: '/email/messages/{message_id}',
      group: 'email',
      action: 'read',
      headers: [],
    },
  ],
};

describe('Policy', () => {
  test('an exact name matches only that operation', () => {
    const policy = new Policy(
      {
        default: 'block',
        rules: [{ match: 'storage.edit_document', decision: 'allow' }],
      },
      OPERATIONS
    );

    expect(policy.decide('storage.edit_document')).toBe('allow');
    expect(policy.decide('storage.get_document')).toBe('block');
  });

  test('group.* matches every operation in the group, whatever its action', () => {
    const policy = new Policy(
      {
        default: 'block',
        rules: [{ match: 'documents.*', decision: 'allow' }],
      },
      OPERATIONS
    );

    expect(policy.decide('storage.edit_document')).toBe('allow');
    expect(policy.decide('storage.delete_document')).toBe('allow');
    expect(policy.decide('email.get_message')).toBe('block');
  });

  test('@action matches that action in every group', () => {
    const policy = new Policy(
      { default: 'block', rules: [{ match: '@read', decision: 'allow' }] },
      OPERATIONS
    );

    expect(policy.decide('storage.get_document')).toBe('allow');
    expect(policy.decide('email.get_message')).toBe('allow');
    expect(policy.decide('email.send_message')).toBe('block');
  });

  test('group@action matches that action within the group only', () => {
    const policy = new Policy(
      {
        default: 'block',
        rules: [{ match: 'documents@update', decision: 'allow' }],
      },
      OPERATIONS
    );

    expect(policy.decide('storage.edit_document')).toBe('allow');
    expect(policy.decide('storage.create_document')).toBe('block');
    expect(policy.decide('email.send_message')).toBe('block');
  });

  test('the last matching rule wins', () => {
    const policy = new Policy(
      {
        default: 'block',
        rules: [
          { match: 'documents.*', decision: 'allow' },
          { match: '@destroy', decision: 'block' },
          { match: 'email.*', decision: 'block' },
          { match: 'email.get_message', decision: 'allow' },
        ],
      },
      OPERATIONS
    );

    expect(policy.decide('storage.edit_document')).toBe('allow');
    expect(policy.decide('storage.delete_document')).toBe('block');
    expect(policy.decide('email.get_message')).toBe('allow');
    expect(policy.decide('email.send_message')).toBe('block');
  });

  test('an operation no rule matches gets the default', () => {
    const allowing = new Policy({ default: 'allow', rules: [] }, OPERATIONS);
    const blocking = new Policy({ default: 'block', rules: [] }, OPERATIONS);

    expect(allowing.decide('email.send_message')).toBe('allow');
    expect(blocking.decide('email.send_message')).toBe('block');
  });

  test.each([
    'storage.edit',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
  ])(
    'the unknown or inherited name %s is blocked even when the default allows',
    (name) => {
      const policy = new Policy({ default: 'allow', rules: [] }, OPERATIONS);

      expect(policy.decide(name)).toBe('block');
    }
  );

  test.each([
    ['storage.edit', 'no operation has this name'],
    ['document.*', 'no operation is in group "document"'],
    ['@delete', 'the action after @ must be one of'],
    ['@write', 'the action after @ must be one of'],
    ['document@update', 'no operation is in group "document"'],
    ['__proto__.*', 'no operation is in group "__proto__"'],
  ])('rejects the rule %s when the policy is built', (selector, message) => {
    expect(
      () =>
        new Policy(
          { default: 'allow', rules: [{ match: selector, decision: 'block' }] },
          OPERATIONS
        )
    ).toThrow(message);
  });

  test('a table with a duplicate name fails', () => {
    const first = OPERATIONS.operations[0];
    if (!first) throw new Error('fixture is empty');

    expect(
      () =>
        new Policy(
          { default: 'allow', rules: [] },
          { operations: [first, { ...first, path: '/other' }] }
        )
    ).toThrow('storage.create_document is listed twice');
  });
});

describe('POST /v1/decide', () => {
  const handle = permissionsHandler(
    new Policy(
      { default: 'allow', rules: [{ match: '@destroy', decision: 'block' }] },
      OPERATIONS
    )
  );

  test('answers allow or block for every requested operation', async () => {
    const response = await handle(
      new Request('http://permissions.test/v1/decide', {
        method: 'POST',
        body: JSON.stringify({
          methods: [
            'storage.edit_document',
            'storage.delete_document',
            'nope.nothing',
            '__proto__',
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    // Compare the text: `__proto__` must be an own key with its decision,
    // which a parsed-object comparison can't show.
    expect(await response.text()).toBe(
      '{"decisions":{"storage.edit_document":"allow","storage.delete_document":"block","nope.nothing":"block","__proto__":"block"}}'
    );
  });

  test('rejects a body without methods', async () => {
    const response = await handle(
      new Request('http://permissions.test/v1/decide', {
        method: 'POST',
        body: '{"method": "storage.edit_document"}',
      })
    );

    expect(response.status).toBe(400);
  });
});
