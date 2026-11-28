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
import type { AnyVariables, CombinedError, OperationResult } from '@urql/core';
import {
  CommitCrmMergeDocument,
  type CommitCrmMergeInput,
  EditCrmCompanyDomainDocument,
  type EditCrmCompanyDomainInput,
  type EntityMutationResultFieldsFragment,
  InsertCrmPipelineRowsDocument,
  type InsertCrmPipelineRowsInput,
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

type EffectPayload =
  | ({ result?: EntityMutationResultFieldsFragment | null } & (
      | { companyId: string }
      | { survivorId: string; mergedIds: string[] }
    ))
  | { rowIds: string[]; rows: { id: string }[] | null };

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
  /** CSV import refreshes its lists once after all batches commit. */
  batch?: boolean;
};

function hasAllEffects(payload: EffectPayload) {
  if ('rowIds' in payload) {
    const resolved = new Set(payload.rows?.map((row) => row.id));
    return payload.rowIds.every((id) => resolved.has(id));
  }
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

function requireCommittedPayload<T>(
  payload: T | undefined,
  error: CombinedError | undefined
): T {
  if (
    error &&
    (!payload ||
      error.networkError ||
      error.graphQLErrors.some(
        ({ path }) => path?.[1] !== 'result' || path[2] !== 'effects'
      ))
  ) {
    if (!error.graphQLErrors.length) throw error;
    throw new CrmGraphqlWriteError(error);
  }
  if (!payload) throw new Error('CRM write returned no outcome');
  return payload;
}

function acceptedEffects(result: OperationResult) {
  const metadata = normalizedCacheResultMetadata(result);
  return (
    !result.error &&
    !(
      metadata?.source === 'live-network' &&
      metadata.cacheEffectsApplied === false
    ) &&
    queuedMutationCommitOf(result)?.cacheEffectsApplied !== false
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
  let settle: (event: MutationSettlement | undefined) => void;
  const settlement = new Promise<MutationSettlement | undefined>((resolve) => {
    settle = resolve;
  });
  const stopSettled = host?.onMutationSettled((event) => {
    if (event.mutationUuid === uuid) settle(event);
  });
  const stopSession =
    host && cacheSessionGeneration.onChanged(() => settle(undefined));

  try {
    const result = await client
      .mutation(document, variables, {
        ...(host
          ? optimisticMutationContext(
              {},
              {
                uuid,
                revalidations: options.batch
                  ? []
                  : getActiveGraphqlSoupRevalidations(client, {
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
        deferNetworkRevalidation: options.batch,
      })
      .toPromise();

    if (optimisticMutationDispositionOf(result)?.kind === 'queued') {
      // The dialogs report a saved write only once it commits.
      // Keep waiting for the durable command if its first delivery went offline.
      const event = await settlement;
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
        cacheRevalidates: !options.batch,
        listsReadAgain: false,
      };
    }

    const payload = requireCommittedPayload(
      result.data && select(result.data),
      result.error
    );
    const queuedCommit = queuedMutationCommitOf(result);
    const effectsResolved = acceptedEffects(result) && hasAllEffects(payload);
    return {
      payload,
      effectsResolved,
      cacheRevalidates:
        !!queuedCommit?.transactionId && effectsResolved && !options.batch,
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

export function insertGraphqlCrmPipelineRows(
  input: InsertCrmPipelineRowsInput
) {
  return Telemetry.span('crm.pipeline_import_batch', (span) => {
    span.setAttr('crm.pipeline_id', String(input.pipelineId));
    span.setAttr('crm.import.batch_rows', input.rows.length);
    return edit(
      InsertCrmPipelineRowsDocument,
      { input },
      (data) => data.insertCrmPipelineRows,
      { span, batch: true }
    );
  });
}
