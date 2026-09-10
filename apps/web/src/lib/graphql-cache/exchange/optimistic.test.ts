import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { GroupSoupMembershipDocument } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { describe, expect, it } from 'vitest';
import {
  executeOptimisticMutation,
  prependUnique,
  remove,
  removeEmbeddedLink,
  select,
  update,
  upsertEmbeddedLink,
} from './optimistic';

const input = {
  initial: {
    groupBy: {
      field: 'PROPERTY' as const,
      propertyDefinitionId: 'status-def',
    },
    limit: 20,
  },
};

function itemsIn(groupKey: string) {
  return select(GroupSoupMembershipDocument, { input })
    .field('user')
    .field('groupSoup')
    .field('bins')
    .item('key', groupKey)
    .field('items');
}

describe('typed optimistic graph updates', () => {
  it('serializes a generated query entrypoint, variables, path, and diff', () => {
    const removal = update(
      itemsIn('in-progress'),
      remove({ __typename: 'GraphqlSoupDocument', id: 'task-1' })
    );
    const prepend = update(
      itemsIn('completed'),
      prependUnique({ __typename: 'GraphqlSoupDocument', id: 'task-1' })
    );

    expect(removal.operationName).toBe('GroupSoupMembership');
    expect(JSON.parse(removal.variablesJson)).toEqual({ input });
    expect(removal.path).toEqual([
      { field: 'user' },
      { field: 'groupSoup' },
      { field: 'bins' },
      { listItem: { whereField: 'key', equals: 'in-progress' } },
      { field: 'items' },
    ]);
    expect(removal.operation).toEqual({
      kind: 'remove',
      entityKey: 'GraphqlSoupDocument:task-1',
    });
    expect(prepend.operation.kind).toBe('prependUnique');
  });

  it('serializes counted embedded link changes', () => {
    const bins = select(GroupSoupMembershipDocument, { input })
      .field('user')
      .field('groupSoup')
      .field('bins');
    const entity = { __typename: 'GraphqlSoupDocument', id: 'task-1' };
    const removal = removeEmbeddedLink(bins, {
      listItem: { whereField: 'key', equals: 'high' },
      linkField: 'items',
      countField: 'totalCount',
      entity,
    });
    const insertion = upsertEmbeddedLink(bins, {
      listItem: { whereField: 'key', equals: 'urgent' },
      linkField: 'items',
      countField: 'totalCount',
      entity,
      insertFields: { nextCursor: null },
    });

    expect(removal.operation).toEqual({
      kind: 'removeEmbeddedLink',
      listItem: { whereField: 'key', equals: 'high' },
      linkField: 'items',
      countField: 'totalCount',
      entityKey: 'GraphqlSoupDocument:task-1',
    });
    expect(insertion.path).toEqual([
      { field: 'user' },
      { field: 'groupSoup' },
      { field: 'bins' },
    ]);
    expect(insertion.operation).toEqual({
      kind: 'upsertEmbeddedLink',
      listItem: { whereField: 'key', equals: 'urgent' },
      linkField: 'items',
      countField: 'totalCount',
      entityKey: 'GraphqlSoupDocument:task-1',
      insertFields: { nextCursor: null },
    });
  });

  it('uses generated operation result and variable types', () => {
    const typeAssertions = () => {
      // @ts-expect-error GroupSoupMembership requires an input variable.
      select(GroupSoupMembershipDocument, {});

      const root = select(GroupSoupMembershipDocument, { input });
      // @ts-expect-error `missing` is not selected by this generated query.
      root.field('missing');

      const bins = root.field('user').field('groupSoup').field('bins');
      // @ts-expect-error A bin has no `missing` scalar selector.
      bins.item('missing', 'value');
      // @ts-expect-error The generated bin key is a string.
      bins.item('key', 123);
      update(
        // @ts-expect-error Updates must target a generated list selection.
        root.field('user'),
        remove({ __typename: 'GraphqlUser', id: 'user-1' })
      );
      upsertEmbeddedLink(bins, {
        listItem: { whereField: 'key', equals: 'urgent' },
        linkField: 'items',
        // @ts-expect-error Count fields must be generated numeric fields.
        countField: 'key',
        entity: { __typename: 'GraphqlSoupDocument', id: 'task-1' },
        insertFields: { nextCursor: null },
      });
      upsertEmbeddedLink(bins, {
        listItem: { whereField: 'key', equals: 'urgent' },
        // @ts-expect-error Link fields must be generated normalized-entity lists.
        linkField: 'key',
        countField: 'totalCount',
        entity: { __typename: 'GraphqlSoupDocument', id: 'task-1' },
        insertFields: { nextCursor: null },
      });
      upsertEmbeddedLink(bins, {
        listItem: { whereField: 'key', equals: 'urgent' },
        linkField: 'items',
        countField: 'totalCount',
        entity: { __typename: 'GraphqlSoupDocument', id: 'task-1' },
        insertFields: {
          // @ts-expect-error Managed fields cannot be supplied for insertion.
          key: 'urgent',
        },
      });
    };

    expect(typeAssertions).toBeTypeOf('function');
  });
});

describe('executeOptimisticMutation UUID validation', () => {
  const client = {} as Client;
  const document = {} as TypedDocumentNode<unknown, Record<string, never>>;

  it('rejects an invalid caller UUID before invoking the client', () => {
    expect(() =>
      executeOptimisticMutation(client, document, {}, {}, { uuid: 'invalid' })
    ).toThrow(TypeError);
  });

  it('rejects missing options at runtime', () => {
    expect(() =>
      (
        executeOptimisticMutation as unknown as (
          client: Client,
          document: TypedDocumentNode<unknown, Record<string, never>>,
          variables: Record<string, never>,
          data: unknown
        ) => unknown
      )(client, document, {}, {})
    ).toThrow(TypeError);
  });
});
