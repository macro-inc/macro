import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { ThrownResultError } from '@core/util/result';
import { networkRevalidated } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  optimisticMutationContext,
  optimisticMutationDispositionOf,
  queuedMutationCommitOf,
} from '@graphql-cache/exchange/optimistic';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type Span, Telemetry } from '@macro-inc/observability';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { crmExternalWriteTypes } from '@queries/soup/graphql/external-write-scope';
import type { AnyVariables, CombinedError } from '@urql/core';
import {
  CommitCrmMergeDocument,
  type CommitCrmMergeInput,
  EditCrmCompanyDomainDocument,
  type EditCrmCompanyDomainInput,
  type EntityMutationResultFieldsFragment,
  RenameCrmCompanyDocument,
  type RenameCrmCompanyInput,
} from './graphql/generated/graphql';
import { getGraphqlCacheHost, getGraphqlSoupClient } from './graphql-soup';

/** Structured GraphQL refusal details used by the merge and domain dialogs. */
export class CrmGraphqlWriteError extends ThrownResultError {
  constructor(error: CombinedError) {
    super(
      error.graphQLErrors.map(({ extensions, message }) => ({
        code: String(extensions.code ?? 'UNKNOWN'),
        message:
          extensions.code === 'CONFLICT'
            ? typeof extensions.companyName === 'string'
              ? extensions.companyName
              : ''
            : message,
      }))
    );
    this.extensions = error.graphQLErrors[0]?.extensions;
  }

  readonly extensions: Record<string, unknown> | undefined;
}

type EffectPayload = { result?: EntityMutationResultFieldsFragment | null } & (
  | { companyId: string }
  | { survivorId: string; mergedIds: string[] }
);

type CrmEditOutcome<T> = {
  /** Only the original operation response carries its non-cache fields. */
  payload: T | undefined;
  effectsResolved: boolean;
  cacheRevalidates: boolean;
  listsReadAgain: boolean;
};

type EditOptions = {
  span: Span;
  /** Contacts without a changed company do not affect company-only readers. */
  contactsOnly?: boolean;
};

function hasAllEffects(payload: EffectPayload) {
  const result = payload.result;
  if (result?.__typename !== 'GraphqlMutationSuccess') return false;
  const survivor =
    'companyId' in payload ? payload.companyId : payload.survivorId;
  return (
    result.effects.some(
      (effect) =>
        effect.__typename === 'SoupUpdated' && effect.item.id === survivor
    ) &&
    ('companyId' in payload ||
      payload.mergedIds.every((id) =>
        result.effects.some(
          (effect) =>
            effect.__typename === 'GraphqlCacheDeletion' &&
            effect.entityId === id
        )
      ))
  );
}

async function edit<
  Data,
  Variables extends AnyVariables,
  Payload extends EffectPayload,
>(
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  select: (data: Data) => Payload,
  options: EditOptions
): Promise<CrmEditOutcome<Payload>> {
  const client = getGraphqlSoupClient();
  const host = getGraphqlCacheHost();
  const uuid = crypto.randomUUID();
  const settlement = Promise.withResolvers<MutationSettlement | undefined>();
  const stopSettled = host?.onMutationSettled((event) => {
    if (event.mutationUuid === uuid) settlement.resolve(event);
  });
  const stopSession =
    host &&
    cacheSessionGeneration.onChanged(() => settlement.resolve(undefined));

  try {
    const result = await client
      .mutation(document, variables, {
        ...(host
          ? optimisticMutationContext(
              {},
              {
                uuid,
                revalidations: getActiveGraphqlSoupRevalidations(client, {
                  unmaintainedOnly: true,
                  where: (filters) => {
                    const types = crmExternalWriteTypes(filters);
                    return options.contactsOnly
                      ? types.includes('GraphqlSoupCrmContact')
                      : types.length > 0;
                  },
                }),
              }
            )
          : { optimisticMutation: false }),
        [TRACE_PARENT_CONTEXT_KEY]: options.span,
      })
      .toPromise();

    if (optimisticMutationDispositionOf(result)?.kind === 'queued') {
      // The dialogs report a saved write only once it commits.
      // Keep waiting for the durable command if its first delivery went offline.
      const event = await settlement.promise;
      if (event?.status === 'permanently-failed') {
        throw new ThrownResultError([
          { code: event.errorCode ?? 'UNKNOWN', message: event.error },
        ]);
      }
      if (event?.status !== 'committed')
        throw new Error('CRM write could not be confirmed');
      return {
        payload: undefined,
        effectsResolved: true,
        cacheRevalidates: true,
        listsReadAgain: false,
      };
    }

    const payload = result.data && select(result.data);
    if (
      result.error &&
      (!payload ||
        result.error.networkError ||
        result.error.graphQLErrors.some(
          (error) => error.path?.[1] !== 'result' || error.path[2] !== 'effects'
        ))
    ) {
      if (result.error.graphQLErrors.length === 0) throw result.error;
      throw new CrmGraphqlWriteError(result.error);
    }
    if (!payload) throw new Error('CRM write returned no outcome');
    const cache = normalizedCacheResultMetadata(result);
    const queuedCommit = queuedMutationCommitOf(result);
    const effectsResolved =
      !result.error &&
      hasAllEffects(payload) &&
      !(
        cache?.source === 'live-network' && cache.cacheEffectsApplied === false
      ) &&
      queuedCommit?.cacheEffectsApplied !== false;
    return {
      payload,
      effectsResolved,
      cacheRevalidates: !!queuedCommit?.transactionId && effectsResolved,
      listsReadAgain: networkRevalidated(result),
    };
  } finally {
    stopSettled?.();
    stopSession?.();
  }
}

export function renameGraphqlCrmCompany(input: RenameCrmCompanyInput) {
  return Telemetry.span('crm.company_rename', (span) => {
    span.setAttr('crm.record_id', String(input.companyId));
    return edit(
      RenameCrmCompanyDocument,
      { input },
      (data) => data.renameCrmCompany,
      { span }
    );
  });
}

export const editGraphqlCrmCompanyDomain = (
  input: EditCrmCompanyDomainInput,
  span: Span
) =>
  edit(
    EditCrmCompanyDomainDocument,
    { input },
    (data) => data.editCrmCompanyDomain,
    { span }
  );

export const commitGraphqlCrmMerge = (input: CommitCrmMergeInput, span: Span) =>
  edit(CommitCrmMergeDocument, { input }, (data) => data.commitCrmMerge, {
    span,
    contactsOnly: input.recordType === 'CONTACT',
  });
