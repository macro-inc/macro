import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { ThrownResultError } from '@core/util/result';
import { networkRevalidated } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  optimisticMutationContext,
  optimisticMutationDispositionOf,
  queuedMutationCommitOf,
} from '@graphql-cache/exchange/optimistic';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { Telemetry } from '@macro-inc/observability';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { crmExternalWriteTypes } from '@queries/soup/graphql/external-write-scope';
import type { CombinedError } from '@urql/core';
import {
  CreateCrmCompanyDocument,
  type CreateCrmCompanyInput,
  type CreateCrmCompanyMutation,
  CreateCrmContactDocument,
  type CreateCrmContactInput,
  type CreateCrmContactMutation,
  type EntityMutationResultFieldsFragment,
} from './graphql/generated/graphql';
import { getGraphqlCacheHost, getGraphqlSoupClient } from './graphql-soup';

type CrmCreateMode = 'queue' | 'direct' | 'batch';
type CreatedRecord = {
  recordId: string;
  result?: EntityMutationResultFieldsFragment | null;
};

type CrmCreateOutcome =
  | { queued: true; id?: undefined }
  | {
      queued: false;
      id: string;
      effectsResolved: boolean;
      listsReadAgain: boolean;
      cacheRevalidates: boolean;
    };

function requireCreatedRecord(
  record: CreatedRecord | undefined,
  error: CombinedError | undefined
): CreatedRecord {
  // Effects resolve after the write. Preserve the authoritative ID if its
  // Soup rows could not be hydrated.
  if (
    error &&
    (!record?.recordId ||
      error.networkError ||
      error.graphQLErrors.some(
        (item) => item.path?.[1] !== 'result' || item.path[2] !== 'effects'
      ))
  ) {
    if (error.graphQLErrors.length === 0) throw error;
    throw new ThrownResultError(
      error.graphQLErrors.map((item) => ({
        code: String(item.extensions.code ?? 'UNKNOWN'),
        message: item.message,
      }))
    );
  }
  if (!record?.recordId) throw new Error('CRM create returned no record ID');
  return record;
}

async function createCrmRecord<
  Data,
  Input extends { requestId: string | number },
>(
  kind: 'company' | 'contact',
  document: TypedDocumentNode<Data, { input: Input }>,
  input: Omit<Input, 'requestId'>,
  select: (data: Data) => CreatedRecord,
  mode: CrmCreateMode,
  contactsOnly: boolean
): Promise<CrmCreateOutcome> {
  return Telemetry.span(`crm.${kind}.create`, async (span) => {
    if ('domain' in input)
      span.setAttr('crm.company.has_domain', !!input.domain);
    if ('companyId' in input && typeof input.companyId === 'string')
      span.setAttr('crm.company.id', input.companyId);
    const requestId = crypto.randomUUID();
    const client = getGraphqlSoupClient();
    // A command can be persisted before its team-scoped record ID is known.
    const context =
      mode === 'queue' && getGraphqlCacheHost()
        ? optimisticMutationContext(
            {},
            {
              uuid: requestId,
              revalidations: getActiveGraphqlSoupRevalidations(client, {
                unmaintainedOnly: true,
                where: (filters) => {
                  const types = crmExternalWriteTypes(filters);
                  return contactsOnly
                    ? types.includes('GraphqlSoupCrmContact')
                    : types.length > 0;
                },
              }),
            }
          )
        : { optimisticMutation: false as const };
    const result = await client
      .mutation(
        document,
        { input: { ...input, requestId } as Input },
        {
          ...context,
          [TRACE_PARENT_CONTEXT_KEY]: span,
          deferNetworkRevalidation: mode === 'batch',
        }
      )
      .toPromise();
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') return { queued: true };

    const record = requireCreatedRecord(
      result.data && select(result.data),
      result.error
    );
    const metadata = normalizedCacheResultMetadata(result);
    const queueCommit = queuedMutationCommitOf(result);
    const effectsResolved =
      record.result?.__typename === 'GraphqlMutationSuccess' &&
      record.result.effects.some(
        (effect) =>
          effect.__typename === 'SoupUpdated' &&
          effect.item.id === record.recordId
      ) &&
      !result.error &&
      queueCommit?.cacheEffectsApplied !== false &&
      !(
        metadata?.source === 'live-network' &&
        metadata.cacheEffectsApplied === false
      );
    span.setAttr(`crm.${kind}.id`, record.recordId);
    span.setAttr('crm.create.effects_resolved', effectsResolved);
    return {
      id: record.recordId,
      queued: false,
      cacheRevalidates: !!queueCommit?.transactionId && effectsResolved,
      effectsResolved,
      listsReadAgain: networkRevalidated(result),
    };
  });
}

export function createGraphqlCrmCompany(
  input: Omit<CreateCrmCompanyInput, 'requestId'>,
  mode: CrmCreateMode = 'queue'
) {
  return createCrmRecord<CreateCrmCompanyMutation, CreateCrmCompanyInput>(
    'company',
    CreateCrmCompanyDocument,
    input,
    (data) => data.createCrmCompany,
    mode,
    false
  );
}

export function createGraphqlCrmContact(
  input: Omit<CreateCrmContactInput, 'requestId'>,
  mode: CrmCreateMode = 'queue'
) {
  return createCrmRecord<CreateCrmContactMutation, CreateCrmContactInput>(
    'contact',
    CreateCrmContactDocument,
    input,
    (data) => data.createCrmContact,
    mode,
    !!input.companyId
  );
}
