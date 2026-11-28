/**
 * A GraphQL server in the test process: urql operations run with graphql-js
 * against the production schema (`static_assets/schema.graphql`, plus the
 * client's `@cacheOnly` directive) and a caller's root value, so responses
 * have exactly the shapes the server's schema allows. Each document is
 * validated once; a document the schema refuses is recorded as an error.
 *
 * Subscriptions arrive the way the app's websocket client hands them over
 * (`socket`, for `sessionSubscriptionExchange`) and stay open until the client
 * ends them; `push` sends each open subscription of one operation a frame.
 */
import { fireAndForget } from '@core/util/fireAndForget';
import type { Exchange, Operation, OperationResult } from '@urql/core';
import { CombinedError } from '@urql/core';
import {
  buildSchema,
  type DocumentNode,
  type ExecutionResult,
  execute,
  type GraphQLSchema,
  parse,
  validate,
} from 'graphql';
import type { Client as GraphqlWsClient, Sink } from 'graphql-ws';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';
import schemaSdl from '../../../../../../static_assets/schema.graphql?raw';
import clientSchemaSdl from '../../../../graphql-client-schema.graphql?raw';

let schema: GraphQLSchema | undefined;

function productionSchema(): GraphQLSchema {
  schema ??= buildSchema(`${schemaSdl}\n${clientSchemaSdl}`);
  return schema;
}

/** What the network answered, by operation. */
export type FixtureNetworkLog = {
  /** Queries and mutations by name, in the order they arrived. */
  operations: string[];
  /** Subscription frames pushed, by operation name, in order. */
  frames: string[];
  /** Validation and field errors; a faithful fixture has none. */
  errors: string[];
  /** Queries and mutations by name since `mark`. */
  countsSince(mark: number): Record<string, number>;
  mark(): number;
  /** Operations sent and frames pushed that have not been answered yet. */
  inFlight(): number;
  /** Subscriptions open now, by operation name. */
  openSubscriptions(): Record<string, number>;
};

export type FixtureNetwork = {
  exchange: Exchange;
  /** The websocket client for `sessionSubscriptionExchange`. */
  socket: Pick<GraphqlWsClient, 'subscribe'>;
  /** Sends every open `operationName` subscription one frame, executed
   * against `rootValue`; resolves once each frame reached its sink. */
  push(operationName: string, rootValue: unknown): Promise<number>;
  log: FixtureNetworkLog;
};

function operationName(document: DocumentNode): string {
  for (const definition of document.definitions)
    if (definition.kind === 'OperationDefinition' && definition.name)
      return definition.name.value;
  return 'anonymous';
}

type OpenSubscription = {
  document: DocumentNode;
  variables: Record<string, unknown> | undefined;
  sink: Sink<ExecutionResult>;
};

/**
 * The terminating exchange and websocket for a harness client. Queries and
 * mutations run against `rootValue()`; teardowns end without a result.
 */
export function createFixtureNetwork(rootValue: () => unknown): FixtureNetwork {
  const operations: string[] = [];
  const frames: string[] = [];
  const errors: string[] = [];
  const validated = new WeakSet<DocumentNode>();
  const subscriptions = new Map<string, Set<OpenSubscription>>();
  let pending = 0;
  const log: FixtureNetworkLog = {
    operations,
    frames,
    errors,
    mark: () => operations.length,
    countsSince: (mark) => {
      const counts: Record<string, number> = {};
      for (const name of operations.slice(mark))
        counts[name] = (counts[name] ?? 0) + 1;
      return counts;
    },
    inFlight: () => pending,
    openSubscriptions: () =>
      Object.fromEntries(
        [...subscriptions].map(([name, open]) => [name, open.size])
      ),
  };
  const checkDocument = (document: DocumentNode, name: string) => {
    if (validated.has(document)) return;
    validated.add(document);
    for (const error of validate(productionSchema(), document))
      errors.push(`${name}: invalid document: ${error.message}`);
  };
  const recordErrors = (name: string, result: ExecutionResult) => {
    for (const error of result.errors ?? [])
      errors.push(`${name}: ${error.message} at ${error.path?.join('.')}`);
  };
  const run = async (operation: Operation): Promise<OperationResult> => {
    const name = operationName(operation.query);
    operations.push(name);
    checkDocument(operation.query, name);
    const result = await execute({
      schema: productionSchema(),
      document: operation.query,
      operationName: name === 'anonymous' ? undefined : name,
      variableValues: operation.variables as Record<string, unknown>,
      rootValue: rootValue(),
    });
    recordErrors(name, result);
    return {
      operation,
      data: result.data ?? undefined,
      error: result.errors?.length
        ? new CombinedError({ graphQLErrors: [...result.errors] })
        : undefined,
      stale: false,
      hasNext: false,
    };
  };
  // Never rejects: a throw is recorded as an error and ends the operation.
  const answer = async (
    operation: Operation,
    response: ReturnType<typeof makeSubject<OperationResult>>
  ) => {
    try {
      response.next(await run(operation));
    } catch (error) {
      errors.push(`${operationName(operation.query)}: ${String(error)}`);
    } finally {
      pending -= 1;
      response.complete();
    }
  };
  const exchange: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter(
        (operation) =>
          operation.kind === 'query' || operation.kind === 'mutation'
      ),
      mergeMap((operation) => {
        const response = makeSubject<OperationResult>();
        pending += 1;
        queueMicrotask(() =>
          fireAndForget(answer(operation, response), 'cache-harness')
        );
        return response.source;
      })
    );
  const socket: FixtureNetwork['socket'] = {
    subscribe(payload, sink) {
      const document = parse(payload.query);
      const name = operationName(document);
      checkDocument(document, name);
      const open: OpenSubscription = {
        document,
        variables: payload.variables ?? undefined,
        sink: sink as Sink<ExecutionResult>,
      };
      const named = subscriptions.get(name) ?? new Set();
      named.add(open);
      subscriptions.set(name, named);
      return () => {
        named.delete(open);
      };
    },
  };
  const deliver = async (
    name: string,
    open: OpenSubscription,
    frame: unknown
  ) => {
    try {
      const result = await execute({
        schema: productionSchema(),
        document: open.document,
        variableValues: open.variables,
        rootValue: frame,
      });
      recordErrors(name, result);
      open.sink.next(result);
    } catch (error) {
      errors.push(`${name}: ${String(error)}`);
    } finally {
      pending -= 1;
    }
  };
  const push: FixtureNetwork['push'] = async (name, frame) => {
    const open = [...(subscriptions.get(name) ?? [])];
    frames.push(name);
    pending += open.length;
    await Promise.all(open.map((each) => deliver(name, each, frame)));
    return open.length;
  };
  return { exchange, socket, push, log };
}
