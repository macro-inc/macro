import { queryAuthorization } from '@app/lib/urql-solid/authorization';
import {
  CombinedError,
  type Exchange,
  makeOperation,
  stringifyDocument,
} from '@urql/core';
import { fromPromise, map, mergeMap, pipe } from 'wonka';
import { StaleCacheAuthorityError } from '../authority';
import { queryNeedsCrmProof } from '../authority-scope';
import {
  assertResponseAuthority,
  captureOperationResponse,
  operationResponse,
  preserveMutationOutcome,
  responseAuthorityGeneration,
} from '../response-authority';
import {
  markSourceAuthority,
  sourceAuthorityEpoch,
  sourceAuthorityGeneration,
} from '../source-authority';
import { optimisticMutationDispositionOf } from './optimistic';

/** Outermost admission covers awaits in every inner exchange, including revalidation. */
export const cacheAuthorityExchange: Exchange =
  ({ forward }) =>
  (operations) =>
    pipe(
      operations,
      map((operation) =>
        captureOperationResponse(
          makeOperation(operation.kind, operation, {
            ...operation.context,
            cacheAuthorizationEpoch: queryAuthorization().epoch,
          })
        )
      ),
      forward,
      mergeMap((result) =>
        fromPromise(
          (async () => {
            if (result.data == null) return result;
            try {
              await assertResponseAuthority(
                operationResponse(result.operation)
              );
              const authorization = queryAuthorization();
              const epoch =
                result.operation.kind === 'subscription'
                  ? (sourceAuthorityEpoch(result.data) ??
                    result.operation.context.cacheSourceAuthorizationEpoch)
                  : result.operation.context.cacheAuthorizationEpoch;
              if (
                queryNeedsCrmProof(
                  stringifyDocument(result.operation.query),
                  result.operation.variables as Record<string, unknown>
                ) &&
                (authorization.paused || epoch !== authorization.epoch)
              )
                throw new StaleCacheAuthorityError();
              markSourceAuthority(
                result.data,
                responseAuthorityGeneration(
                  operationResponse(result.operation)
                ) ??
                  sourceAuthorityGeneration(result.data) ??
                  result.operation.context.cacheAuthorityGeneration,
                epoch
              );
              return result;
            } catch (error) {
              const outcome = preserveMutationOutcome(result);
              if (outcome) return outcome;
              return {
                ...result,
                data: undefined,
                error: optimisticMutationDispositionOf(result)
                  ? result.error
                  : new CombinedError({
                      networkError:
                        error instanceof Error
                          ? error
                          : new Error(String(error)),
                    }),
              };
            }
          })()
        )
      )
    );
