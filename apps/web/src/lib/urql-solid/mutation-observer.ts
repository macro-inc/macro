import type {
  AnyVariables,
  Client,
  Operation,
  OperationResult,
  OperationResultSource,
} from '@urql/core';
import type { UrqlObserver } from './observer';
import type {
  UrqlMutationExecutionOptions,
  UrqlMutationOptions,
  UrqlMutationResult,
} from './types';
import { ObserverResult, toCombinedError } from './utils';

type MutationOptions<
  MutationData,
  Variables extends AnyVariables,
  Input,
  OnMutateResult,
> = UrqlMutationOptions<MutationData, Variables, Input, OnMutateResult>;

type ExecutionOptions<
  MutationData,
  Variables extends AnyVariables,
  Input,
  OnMutateResult,
> = UrqlMutationExecutionOptions<
  MutationData,
  Variables,
  Input,
  OnMutateResult
>;

type MutationResult<
  MutationData,
  Variables extends AnyVariables,
  Input,
  OnMutateResult,
> = UrqlMutationResult<MutationData, Variables, Input, OnMutateResult>;

type MutationState<MutationData, Variables extends AnyVariables> = {
  data: MutationData | undefined;
  error: UrqlMutationResult<MutationData, Variables>['error'];
  isPending: boolean;
  stale: boolean;
  operation: Operation<MutationData, Variables> | undefined;
};

function isOperationResultSource<MutationData, Variables extends AnyVariables>(
  value:
    | OperationResultSource<OperationResult<MutationData, Variables>>
    | Promise<OperationResult<MutationData, Variables>>
): value is OperationResultSource<OperationResult<MutationData, Variables>> {
  return 'toPromise' in value && typeof value.toPromise === 'function';
}

/** Framework-neutral observer for imperative urql mutations. */
export class MutationObserver<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
  OnMutateResult = void,
> implements
    UrqlObserver<
      MutationOptions<MutationData, Variables, Input, OnMutateResult>,
      MutationResult<MutationData, Variables, Input, OnMutateResult>
    >
{
  private client: Client;
  private options: MutationOptions<
    MutationData,
    Variables,
    Input,
    OnMutateResult
  >;
  private state: MutationState<MutationData, Variables> = {
    data: undefined,
    error: null,
    isPending: false,
    stale: false,
    operation: undefined,
  };
  private readonly result = new ObserverResult(() => this.getCurrentResult());
  private latestExecution: object | undefined;
  private activeExecutions = 0;
  private destroyed = false;

  constructor(
    client: Client,
    options: MutationOptions<MutationData, Variables, Input, OnMutateResult>
  ) {
    this.client = client;
    this.options = options;
  }

  getCurrentResult(): MutationResult<
    MutationData,
    Variables,
    Input,
    OnMutateResult
  > {
    return {
      ...this.state,
      mutate: this.mutate,
      mutateAsync: this.mutateAsync,
    };
  }

  setOptions(
    options: MutationOptions<MutationData, Variables, Input, OnMutateResult>,
    client: Client
  ): void {
    if (this.destroyed) return;

    this.options = options;
    this.client = client;
  }

  subscribe(
    listener: (
      result: MutationResult<MutationData, Variables, Input, OnMutateResult>
    ) => void
  ): () => void {
    return this.result.subscribe(listener);
  }

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.result.clear();
  }

  readonly mutate = (
    input: Input,
    options: ExecutionOptions<
      MutationData,
      Variables,
      Input,
      OnMutateResult
    > = {}
  ): void => {
    void this.mutateAsync(input, options).catch(() => undefined);
  };

  readonly mutateAsync = async (
    input: Input,
    executionOptions: ExecutionOptions<
      MutationData,
      Variables,
      Input,
      OnMutateResult
    > = {}
  ): Promise<OperationResult<MutationData, Variables>> => {
    if (this.destroyed) {
      throw new Error('cannot execute a destroyed mutation observer');
    }

    const execution = {};
    const options = this.options;
    const client = this.client;
    const mergedContext = {
      ...options.context,
      ...executionOptions.context,
    };
    let onMutateResult: OnMutateResult | undefined;

    this.latestExecution = execution;
    this.activeExecutions += 1;
    this.setState({ isPending: true });
    this.result.notify();

    try {
      let result: OperationResult<MutationData, Variables>;
      try {
        onMutateResult = options.onMutate
          ? await options.onMutate(input)
          : undefined;

        if (options.execute) {
          const executionResult = options.execute({
            client,
            mutation: options.mutation,
            input,
            context: mergedContext,
          });
          result = isOperationResultSource(executionResult)
            ? await executionResult.toPromise()
            : await executionResult;
        } else {
          result = await client
            .mutation(
              options.mutation,
              input as unknown as Variables,
              mergedContext
            )
            .toPromise();
        }
      } catch (cause) {
        const error = toCombinedError(cause);
        if (!this.destroyed && this.latestExecution === execution) {
          this.setState({ error, stale: false });
          this.result.notify();
        }

        const errorArgs = [error, input, onMutateResult, undefined] as const;
        const settledArgs = [
          undefined,
          error,
          input,
          onMutateResult,
          undefined,
        ] as const;

        try {
          await options.onError?.(...errorArgs);
          await executionOptions.onError?.(...errorArgs);
        } finally {
          await options.onSettled?.(...settledArgs);
          await executionOptions.onSettled?.(...settledArgs);
        }

        throw error;
      }

      const error = result.error ?? null;
      if (!this.destroyed && this.latestExecution === execution) {
        this.setState({
          data: result.data,
          error,
          stale: result.stale === true,
          operation: result.operation,
        });
        this.result.notify();
      }

      const settledArgs = [
        result.data,
        error,
        input,
        onMutateResult,
        result,
      ] as const;

      try {
        if (error) {
          const errorArgs = [error, input, onMutateResult, result] as const;
          await options.onError?.(...errorArgs);
          await executionOptions.onError?.(...errorArgs);
        } else {
          const successArgs = [
            result.data,
            input,
            onMutateResult,
            result,
          ] as const;
          await options.onSuccess?.(...successArgs);
          await executionOptions.onSuccess?.(...successArgs);
        }
      } finally {
        await options.onSettled?.(...settledArgs);
        await executionOptions.onSettled?.(...settledArgs);
      }

      return result;
    } finally {
      this.activeExecutions -= 1;
      if (!this.destroyed) {
        this.setState({ isPending: this.activeExecutions > 0 });
        this.result.notify();
      }
    }
  };

  private setState(
    nextState: Partial<MutationState<MutationData, Variables>>
  ): void {
    this.state = { ...this.state, ...nextState };
  }
}

/** Creates an observer for {@link createUrqlMutation}. */
export function createMutationObserver<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
  OnMutateResult = void,
>(
  client: Client,
  options: MutationOptions<MutationData, Variables, Input, OnMutateResult>
): MutationObserver<MutationData, Variables, Input, OnMutateResult> {
  return new MutationObserver(client, options);
}
