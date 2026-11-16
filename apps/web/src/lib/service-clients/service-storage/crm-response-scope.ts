import { queryNeedsCrmProof } from '@graphql-cache/authority-scope';
import { getOperationAST, parse } from 'graphql';

type ResponseScope = { protected: boolean; write: boolean };
const read: ResponseScope = { protected: true, write: false };

// These resources have their own grants and do not return CRM record content.
const independentResources = new Set([
  'account-managers',
  'agents',
  'annotations',
  'bots',
  'calendar-events',
  'call',
  'channel-labels',
  'channel-sections',
  'channels',
  'dictation',
  'documents',
  'external-chats',
  'forms',
  'harness-pairings',
  'initiatives',
  'instructions',
  'passwords',
  'projects',
  'slack',
  'sync_service',
  'user-api-keys',
  'user_document_view_location',
  'webhook',
  'whatsapp',
]);

// POST also serves reads. Only known write contracts may bypass content admission.
const storagePostWrites = [
  /^\/crm\/(?:companies|contacts|pipelines)$/,
  /^\/crm\/companies\/import$/,
  /^\/crm\/companies\/[^/]+\/contacts$/,
  /^\/crm\/pipelines\/create$/,
  /^\/crm\/pipelines\/[^/]+\/(?:edit|entries|entries\/remove|import|ops)$/,
  /^\/databases$/,
  /^\/databases\/(?:queries|starter)$/,
  /^\/databases\/[^/]+\/(?:duplicate|import|ops|webhooks)$/,
  /^\/databases\/[^/]+\/changes\/[^/]+\/undo$/,
  /^\/(?:favorites|pins\/[^/]+|saved_views|saved_views\/definitions|saved_views\/exclude_default)$/,
  /^\/history\/[^/]+\/[^/]+$/,
  /^\/messages\/crm_(?:company|contact)\/[^/]+(?:\/items\/[^/]+\/reactions|\/typing)?$/,
];
const emailPostWrites = [
  /^\/(?:init|labels|messages|drafts)$/,
  /^\/contacts\/(?:block|unblock)$/,
  /^\/links\/(?:health-check|[^/]+\/resync)$/,
  /^\/draft-transfers\/[^/]+\/recover$/,
  /^\/drafts\/[^/]+\/(?:attachments|attachments\/[^/]+\/complete|forwarded-attachments|resolve|transfer)$/,
  /^\/threads\/[^/]+\/seen$/,
  /^\/threads\/[^/]+\/messages\/[^/]+\/calendar-invitations\/[^/]+\/copy$/,
  /^\/calendar-events\/[^/]+\/forward$/,
];

/** Unknown requests stay read-like and fail closed; selected GraphQL operations own their kind. */
export async function crmResponseScope(
  service: 'storage' | 'email' | 'agent',
  path: string,
  input: RequestInfo | URL,
  init: RequestInit
): Promise<ResponseScope> {
  const method = (
    init.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (service === 'agent') return read;
  if (
    service === 'storage' &&
    (path === '/items/soup/graphql' || path === '/graphql')
  ) {
    try {
      const body =
        init.body ??
        (input instanceof Request ? await input.clone().text() : undefined);
      const payload =
        method === 'GET'
          ? Object.fromEntries(
              new URL(
                input instanceof Request ? input.url : String(input),
                document.baseURI
              ).searchParams
            )
          : typeof body === 'string'
            ? JSON.parse(body)
            : undefined;
      if (typeof payload?.query !== 'string') return read;
      const variables =
        typeof payload.variables === 'string'
          ? JSON.parse(payload.variables)
          : payload.variables;
      const operation = getOperationAST(
        parse(payload.query),
        payload.operationName
      );
      if (!operation) return read;
      return {
        protected: queryNeedsCrmProof(
          payload.query,
          variables,
          payload.operationName
        ),
        write: operation.operation === 'mutation',
      };
    } catch {
      return read;
    }
  }
  if (service === 'storage') {
    // Even a document attachment can be referenced from a private CRM comment.
    if (/^\/channels\/attachments\/[^/]+\/[^/]+\/references$/.test(path))
      return read;
    const root = path.split('/')[1];
    if (
      independentResources.has(root) ||
      /^\/messages\/(?:channel|document|project|call|calendar_event|initiative)\//.test(
        path
      )
    )
      return {
        protected: false,
        write: !['GET', 'HEAD', 'OPTIONS'].includes(method),
      };
  }
  const relative =
    service === 'email' ? path.replace(/^\/email(?=\/)/, '') : path;
  const writes = service === 'email' ? emailPostWrites : storagePostWrites;
  return {
    protected: true,
    write:
      ['PUT', 'PATCH', 'DELETE'].includes(method) ||
      (method === 'POST' && writes.some((pattern) => pattern.test(relative))),
  };
}
