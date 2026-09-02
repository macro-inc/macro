import {
  type AnyVariables,
  type Client,
  CombinedError,
  type GraphQLRequest,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { makeSubject } from 'wonka';

/** One in-flight GraphQL operation the test can answer or fail. */
export type PendingOperation = {
  name: string;
  variables: Record<string, unknown>;
  resolve(data: unknown): void;
  fail(message: string): void;
};

export type MockGraphql = {
  client: Client;
  pending: PendingOperation[];
  /** The most recent operation with this name, or throws. */
  latest(name: string): PendingOperation;
};

function operationName(query: unknown): string {
  const doc = query as {
    definitions?: Array<{ kind: string; name?: { value: string } }>;
  };
  const op = doc.definitions?.find((d) => d.kind === 'OperationDefinition');
  return op?.name?.value ?? 'anonymous';
}

/**
 * A urql client whose operations stay pending until the test answers them,
 * so loading, error, and pagination transitions are observable in order.
 */
export function createMockGraphql(): MockGraphql {
  const pending: PendingOperation[] = [];
  const executeQuery = <D, V extends AnyVariables>(
    request: GraphQLRequest<D, V>,
    context: Partial<OperationContext> = {}
  ) => {
    const subject = makeSubject<OperationResult<D, V>>();
    const operation = { kind: 'query', context } as Operation<D, V>;
    pending.push({
      name: operationName(request.query),
      variables: (request.variables ?? {}) as Record<string, unknown>,
      resolve: (data) =>
        subject.next({ operation, data } as OperationResult<D, V>),
      fail: (message) =>
        subject.next({
          operation,
          error: new CombinedError({ graphQLErrors: [message] }),
        } as OperationResult<D, V>),
    });
    return subject.source;
  };
  const client = { executeQuery } as unknown as Client;
  return {
    client,
    pending,
    latest(name) {
      const found = [...pending].reverse().find((op) => op.name === name);
      if (!found) throw new Error(`no pending ${name} operation`);
      return found;
    },
  };
}
