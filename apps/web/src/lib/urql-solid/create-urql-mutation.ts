import type { AnyVariables } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createBaseQuery } from './create-base-query';
import { createMutationObserver } from './mutation-observer';
import type { UrqlMutationOptions, UrqlMutationResult } from './types';

/** Creates reactive state for imperative urql mutation executions. */
export function createUrqlMutation<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
  OnMutateResult = void,
>(
  options: Accessor<
    UrqlMutationOptions<MutationData, Variables, Input, OnMutateResult>
  >
): UrqlMutationResult<MutationData, Variables, Input, OnMutateResult> {
  return createBaseQuery(options, createMutationObserver, 'createUrqlMutation');
}
