import {
  hasOwnedEmailWitness,
  queryNeedsCrmProof,
  queryOperationKind,
} from '@graphql-cache/authority-scope';
import { validate as isUuid } from 'uuid';
import { restSoupNeedsCrmProof } from './crm-soup-scope';

type ResponseScope = { protected: boolean; write: boolean };
const read: ResponseScope = { protected: true, write: false };

/** These handlers return caller-private, owned/delegated mailbox reminders. */
export function isEmailReminderPath(path: string): boolean {
  const match = /^\/reminders\/email\/([^/]+)$/.exec(path);
  return !!match && (match[1] === 'collection' || isUuid(match[1]));
}

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

// These handlers resolve an owned/delegated inbox, rather than an entity grant.
// A thread or attachment by ID can instead be shared through CRM and stays gated.
const independentEmailResources = new Set([
  'init',
  'labels',
  'contacts',
  'filters',
  'links',
  'settings',
  'sync',
  'backfill',
  'drafts',
  'draft-transfers',
]);

function independentEmailRequest(path: string, method: string): boolean {
  if (independentEmailResources.has(path.split('/')[1])) return true;
  if (/^\/messages(?:\/batch|\/labels|\/[^/]+)?$/.test(path)) return true;
  if (/^\/threads\/previews\/cursor\/[^/]+$/.test(path)) return true;
  if (/^\/threads\/[^/]+\/(?:messages|operations|read-receipts)$/.test(path))
    return true;
  if (
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) &&
    /^\/threads\/(?:archived|[^/]+\/(?:seen|archived|labels|state))$/.test(path)
  )
    return true;
  // The domain service requires Owner even though its route extracts Edit.
  if (method === 'PATCH' && /^\/threads\/[^/]+\/project$/.test(path))
    return true;
  const thread = /^\/threads\/([^/]+)$/.exec(path);
  return !!thread && hasOwnedEmailWitness(thread[1]);
}

/** Unknown requests stay read-like and fail closed; selected GraphQL operations own their kind. */
export function crmResponseScope(
  service: 'storage' | 'email' | 'agent',
  path: string,
  input: RequestInfo | URL,
  init: RequestInit
): ResponseScope | Promise<ResponseScope> {
  const method = (
    init.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (service === 'agent') return read;
  if (
    service === 'storage' &&
    isEmailReminderPath(path) &&
    (method === 'GET' ||
      (method === 'PUT' && path !== '/reminders/email/collection'))
  )
    return { protected: false, write: method === 'PUT' };
  if (
    service === 'storage' &&
    path === '/items/soup/ast' &&
    method === 'POST'
  ) {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      document.baseURI
    );
    const classify = (body: unknown): ResponseScope => ({
      protected:
        typeof body !== 'string' ||
        restSoupNeedsCrmProof(body, url.searchParams.get('cursor')),
      write: false,
    });
    if (init.body === undefined && input instanceof Request)
      return input
        .clone()
        .text()
        .then(classify, () => read);
    return classify(init.body);
  }
  if (
    service === 'storage' &&
    (path === '/items/soup/graphql' || path === '/graphql')
  ) {
    const classify = (body: unknown): ResponseScope => {
      try {
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
        const operation = queryOperationKind(
          payload.query,
          payload.operationName
        );
        if (!operation) return read;
        return {
          protected: queryNeedsCrmProof(
            payload.query,
            variables,
            payload.operationName
          ),
          write: operation === 'mutation',
        };
      } catch {
        return read;
      }
    };
    if (init.body === undefined && input instanceof Request && method !== 'GET')
      return input
        .clone()
        .text()
        .then(classify, () => read);
    return classify(init.body);
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
    protected:
      service !== 'email' || !independentEmailRequest(relative, method),
    write:
      ['PUT', 'PATCH', 'DELETE'].includes(method) ||
      (method === 'POST' && writes.some((pattern) => pattern.test(relative))),
  };
}
