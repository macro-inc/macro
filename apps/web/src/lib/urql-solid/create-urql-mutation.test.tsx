import {
  type Client,
  CombinedError,
  gql,
  type Operation,
  type OperationContext,
  type OperationResult,
  type OperationResultSource,
} from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUrqlMutation } from './create-urql-mutation';
import type {
  UrqlMutationExecutor,
  UrqlMutationOptions,
  UrqlMutationResult,
} from './types';

type Data = { updateValue: string };
type Variables = { input: string };

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

type FakeExecution = {
  variables: Variables;
  context: Partial<OperationContext>;
  deferred: Deferred<OperationResult<Data, Variables>>;
};

const DOCUMENT = gql`
  mutation UpdateValue($input: String!) {
    updateValue(input: $input)
  }
`;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function resultSource<TData, TVariables extends Record<string, unknown>>(
  promise: Promise<OperationResult<TData, TVariables>>
): OperationResultSource<OperationResult<TData, TVariables>> {
  return {
    toPromise: () => promise,
  } as OperationResultSource<OperationResult<TData, TVariables>>;
}

function operation(
  context: Partial<OperationContext> = {}
): Operation<Data, Variables> {
  return { kind: 'mutation', context } as Operation<Data, Variables>;
}

function makeFakeClient(): { client: Client; executions: FakeExecution[] } {
  const executions: FakeExecution[] = [];
  const client = {
    mutation: vi.fn(
      (
        _document: unknown,
        variables: Variables,
        context: Partial<OperationContext> = {}
      ) => {
        const pending = deferred<OperationResult<Data, Variables>>();
        executions.push({ variables, context, deferred: pending });
        return resultSource(pending.promise);
      }
    ),
  } as unknown as Client;
  return { client, executions };
}

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});

function setup<OnMutateResult = void>(
  options: UrqlMutationOptions<Data, Variables, Variables, OnMutateResult>
): UrqlMutationResult<Data, Variables, Variables, OnMutateResult> {
  let mutation!: UrqlMutationResult<Data, Variables, Variables, OnMutateResult>;
  const dispose = createRoot((rootDispose) => {
    mutation = createUrqlMutation(() => options);
    return rootDispose;
  });
  disposals.push(dispose);
  return mutation;
}

describe('createUrqlMutation', () => {
  it('requires a provider or client override', () => {
    expect(() =>
      createRoot((dispose) => {
        try {
          createUrqlMutation<Data, Variables>(() => ({ mutation: DOCUMENT }));
        } finally {
          dispose();
        }
      })
    ).toThrow(
      'createUrqlMutation requires an UrqlProvider or a client option override'
    );
  });

  it('executes lazily and exposes the latest raw mutation state', async () => {
    const { client, executions } = makeFakeClient();
    const mutation = setup({ mutation: DOCUMENT, client });

    expect(executions).toHaveLength(0);
    expect(mutation.isPending).toBe(false);

    const promise = mutation.mutateAsync({ input: 'first' });
    expect(executions).toHaveLength(1);
    expect(mutation.isPending).toBe(true);

    const result: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'saved' },
      stale: false,
      hasNext: false,
    };
    executions[0].deferred.resolve(result);

    await expect(promise).resolves.toBe(result);
    expect(mutation.isPending).toBe(false);
    expect(mutation.data).toEqual({ updateValue: 'saved' });
    expect(mutation.error).toBeNull();
    expect(mutation.operation).toEqual(result.operation);
  });

  it('submits fire-and-forget mutations', async () => {
    const { client, executions } = makeFakeClient();
    const mutation = setup({ mutation: DOCUMENT, client });

    expect(mutation.mutate({ input: 'fire-and-forget' })).toBeUndefined();
    expect(executions).toHaveLength(1);

    executions[0].deferred.resolve({
      operation: operation(),
      data: { updateValue: 'saved' },
      stale: false,
      hasNext: false,
    });

    await vi.waitFor(() => {
      expect(mutation.isPending).toBe(false);
      expect(mutation.data).toEqual({ updateValue: 'saved' });
    });
  });

  it('supports custom execution with merged operation context', async () => {
    const { client } = makeFakeClient();
    const pending = deferred<OperationResult<Data, Variables>>();
    const execute: UrqlMutationExecutor<Data, Variables> = vi.fn(() =>
      resultSource(pending.promise)
    );
    const mutation = setup({
      mutation: DOCUMENT,
      client,
      context: { requestPolicy: 'network-only', base: true },
      execute,
    });

    const promise = mutation.mutateAsync(
      { input: 'durable' },
      { context: { base: false, execution: true } }
    );

    expect(execute).toHaveBeenCalledWith({
      client,
      mutation: DOCUMENT,
      input: { input: 'durable' },
      context: {
        requestPolicy: 'network-only',
        base: false,
        execution: true,
      },
    });

    const result: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'queued' },
      extensions: {
        normalizedCacheMutationDisposition: {
          kind: 'queued',
          transactionId: 'txn-1',
        },
      },
      stale: false,
      hasNext: false,
    };
    pending.resolve(result);

    await expect(promise).resolves.toBe(result);
  });

  it('lets async executors transform consumer input into GraphQL variables', async () => {
    type Input = { entityId: string; nextValue: string };

    const { client, executions } = makeFakeClient();
    const onSuccess = vi.fn();
    const execute: UrqlMutationExecutor<Data, Variables, Input> = vi.fn(
      async ({ client, mutation, input, context }) => {
        await Promise.resolve();
        return client
          .mutation(
            mutation,
            { input: `${input.entityId}:${input.nextValue}` },
            context
          )
          .toPromise();
      }
    );
    let mutation!: UrqlMutationResult<Data, Variables, Input>;
    const dispose = createRoot((rootDispose) => {
      mutation = createUrqlMutation<Data, Variables, Input>(() => ({
        mutation: DOCUMENT,
        client,
        execute,
        onSuccess,
      }));
      return rootDispose;
    });
    disposals.push(dispose);

    const input: Input = { entityId: 'entity-1', nextValue: 'updated' };
    const promise = mutation.mutateAsync(input);

    await vi.waitFor(() => expect(executions).toHaveLength(1));
    expect(execute).toHaveBeenCalledWith({
      client,
      mutation: DOCUMENT,
      input,
      context: {},
    });
    expect(executions[0].variables).toEqual({
      input: 'entity-1:updated',
    });

    const result: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'updated' },
      stale: false,
      hasNext: false,
    };
    executions[0].deferred.resolve(result);

    await expect(promise).resolves.toBe(result);
    expect(onSuccess).toHaveBeenCalledWith(
      result.data,
      input,
      undefined,
      result
    );
  });

  it('runs configured and per-execution lifecycle callbacks', async () => {
    const { client, executions } = makeFakeClient();
    const events: string[] = [];
    const mutation = setup({
      mutation: DOCUMENT,
      client,
      onMutate: async (variables) => {
        events.push(`mutate:${variables.input}`);
        return { previous: 'before' };
      },
      onSuccess: async (data, variables, context, result) => {
        expect(data).toEqual({ updateValue: 'saved' });
        expect(variables).toEqual({ input: 'callbacks' });
        expect(context).toEqual({ previous: 'before' });
        expect(result.data).toBe(data);
        events.push('configured-success');
      },
      onSettled: (_data, error) => {
        expect(error).toBeNull();
        events.push('configured-settled');
      },
    });

    const promise = mutation.mutateAsync(
      { input: 'callbacks' },
      {
        onSuccess: () => {
          events.push('execution-success');
        },
        onError: () => {
          events.push('execution-error');
        },
        onSettled: () => {
          events.push('execution-settled');
        },
      }
    );

    await vi.waitFor(() => expect(executions).toHaveLength(1));
    const result: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'saved' },
      stale: false,
      hasNext: false,
    };
    executions[0].deferred.resolve(result);
    await expect(promise).resolves.toBe(result);

    expect(events).toEqual([
      'mutate:callbacks',
      'configured-success',
      'execution-success',
      'configured-settled',
      'execution-settled',
    ]);
  });

  it('runs error callbacks for GraphQL results without rejecting', async () => {
    const { client, executions } = makeFakeClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const mutation = setup({
      mutation: DOCUMENT,
      client,
      onSuccess,
      onError,
      onSettled,
    });
    const promise = mutation.mutateAsync({ input: 'graphql-error' });
    const error = new CombinedError({
      graphQLErrors: [new Error('mutation failed')],
    });
    const result: OperationResult<Data, Variables> = {
      operation: operation(),
      error,
      stale: false,
      hasNext: false,
    };
    executions[0].deferred.resolve(result);

    await expect(promise).resolves.toBe(result);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      error,
      { input: 'graphql-error' },
      undefined,
      result
    );
    expect(onSettled).toHaveBeenCalledWith(
      undefined,
      error,
      { input: 'graphql-error' },
      undefined,
      result
    );
  });

  it('keeps the latest execution result during overlapping mutations', async () => {
    const { client, executions } = makeFakeClient();
    const mutation = setup({ mutation: DOCUMENT, client });

    const first = mutation.mutateAsync({ input: 'first' });
    const second = mutation.mutateAsync({ input: 'second' });

    const secondResult: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'second' },
      stale: false,
      hasNext: false,
    };
    executions[1].deferred.resolve(secondResult);
    await second;

    expect(mutation.data).toEqual({ updateValue: 'second' });
    expect(mutation.isPending).toBe(true);

    const firstResult: OperationResult<Data, Variables> = {
      operation: operation(),
      data: { updateValue: 'first' },
      stale: false,
      hasNext: false,
    };
    executions[0].deferred.resolve(firstResult);
    await first;

    expect(mutation.data).toEqual({ updateValue: 'second' });
    expect(mutation.isPending).toBe(false);
  });

  it('stores and reports execution failures as CombinedError', async () => {
    const { client, executions } = makeFakeClient();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const mutation = setup({
      mutation: DOCUMENT,
      client,
      onError,
      onSettled,
    });
    const promise = mutation.mutateAsync({ input: 'failure' });

    executions[0].deferred.reject(new Error('offline executor failed'));

    await expect(promise).rejects.toBeInstanceOf(CombinedError);
    expect(mutation.isPending).toBe(false);
    expect(mutation.error?.networkError?.message).toBe(
      'offline executor failed'
    );
    expect(onError).toHaveBeenCalledWith(
      mutation.error,
      { input: 'failure' },
      undefined,
      undefined
    );
    expect(onSettled).toHaveBeenCalledWith(
      undefined,
      mutation.error,
      { input: 'failure' },
      undefined,
      undefined
    );
  });
});
