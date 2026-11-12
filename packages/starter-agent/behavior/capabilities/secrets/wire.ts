/**
 * The vault API's JSON, in one place: what its answers look like, and the
 * selectors and secret payloads a request carries, as frozen in the agent
 * vault contract (rev 4). Agents use two kinds, `login` and `api`, and only
 * their fixed fields; every other kind shows in search but can't be copied
 * or written.
 */
import { z } from 'zod';

/** Every item kind the vault has. */
export const ItemKind = z.enum([
  'login',
  'api',
  'card',
  'note',
  'identity',
  'verification_code',
]);
export type ItemKind = z.infer<typeof ItemKind>;

/** The fields an agent may copy or write, per kind. */
export const kindFields = {
  login: ['username', 'password'],
  api: ['key', 'secret'],
} as const;
export type AgentKind = keyof typeof kindFields;
export type FieldOf<Kind extends AgentKind> = (typeof kindFields)[Kind][number];
export type SecretField = FieldOf<AgentKind>;

/** The field each agent kind can't be created without. */
export const requiredField = { login: 'password', api: 'secret' } as const;

export const isAgentKind = (kind: ItemKind): kind is AgentKind =>
  kind in kindFields;

export const SecretSelector = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('login'),
    field: z.enum(kindFields.login),
  }),
  z.strictObject({ kind: z.literal('api'), field: z.enum(kindFields.api) }),
]);
export type SecretSelector = z.infer<typeof SecretSelector>;

/** The fields an item of `kind` can be copied from: none for a kind agents can't use. */
export const fieldsOf = (kind: ItemKind): readonly SecretField[] =>
  isAgentKind(kind) ? kindFields[kind] : [];

/** The selector for one field of an item of `kind`, or undefined if that kind has no such field. */
export const selectorFor = (
  kind: ItemKind,
  field: SecretField
): SecretSelector | undefined => {
  const parsed = SecretSelector.safeParse({ kind, field });
  return parsed.success ? parsed.data : undefined;
};

export const ItemSecret = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('login'),
    username: z.string().optional(),
    password: z.string(),
  }),
  z.strictObject({
    kind: z.literal('api'),
    key: z.string().optional(),
    secret: z.string(),
  }),
]);
export type ItemSecret = z.infer<typeof ItemSecret>;

export const ItemSecretPatch = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('login'),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('api'),
    key: z.string().optional(),
    secret: z.string().optional(),
  }),
]);
export type ItemSecretPatch = z.infer<typeof ItemSecretPatch>;

export const AgentEditableMetadata = z.strictObject({
  name: z.string().optional(),
  url: z.string().nullable().optional(),
});
export type AgentEditableMetadata = z.infer<typeof AgentEditableMetadata>;

/** The one purpose v1 has: the value goes to the clipboard. */
export const purpose = 'copy';

// The vault's answers.

export const Permission = z.enum(['view', 'edit']);
export type Permission = z.infer<typeof Permission>;

export const AccessStatus = z.enum(['usable', 'request_access', 'pending']);
export type AccessStatus = z.infer<typeof AccessStatus>;

export const AgentItemAccess = z.object({
  status: AccessStatus,
  useBasis: z.enum(['creator_grant', 'approved_grant']).nullable(),
  canUpdate: z.boolean(),
  canSetTotp: z.boolean(),
  permissionRevision: z.number().int(),
  pendingRequestId: z.string().nullable(),
});
export type AgentItemAccess = z.infer<typeof AgentItemAccess>;

export const AgentSearchHit = z.object({
  id: z.string(),
  name: z.string(),
  kind: ItemKind,
  url: z.string().nullable(),
  version: z.number().int(),
  access: AgentItemAccess,
});
export type AgentSearchHit = z.infer<typeof AgentSearchHit>;

export const SearchPage = z.object({
  items: z.array(AgentSearchHit),
  nextCursor: z.string().nullable(),
});

export const Disclosed = z.object({
  value: z.string(),
  version: z.number().int(),
  selector: SecretSelector,
});

/** A one-time code; `validForMs` is how long it has left when the vault answered, which is all the agent trusts. */
export const TotpCode = z.object({
  code: z.string(),
  expiresAt: z.string(),
  periodSeconds: z.number().int(),
  validForMs: z.number().int().positive(),
});
export type TotpCode = z.infer<typeof TotpCode>;

export const Written = z.object({
  item: AgentSearchHit,
  version: z.number().int(),
});
export type Written = z.infer<typeof Written>;

export const RequestStatus = z.enum([
  'none',
  'pending',
  'approved',
  'denied',
  'revoked',
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const AccessRequestState = z.object({
  requestId: z.string().nullable(),
  itemId: z.string(),
  agentAccountId: z.string(),
  permission: Permission.nullable(),
  status: RequestStatus,
  revision: z.number().int(),
  access: AgentItemAccess,
  updatedAt: z.string().nullable(),
});
export type AccessRequestState = z.infer<typeof AccessRequestState>;

export const ErrorCode = z.enum([
  'unauthorized',
  'invalid_agent',
  'invalid_session_attribution',
  'not_found',
  'not_granted',
  'pending',
  'forbidden',
  'invalid_request',
  'unsupported_kind',
  'field_not_set',
  'rate_limited',
  'version_conflict',
  'vault_busy',
  'vault_unavailable',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  code: ErrorCode,
  retryAfterMs: z.number().int().nonnegative().optional(),
});

/** Where the agent routes are, under the document storage service. */
export const agentBase = (teamId: string): string =>
  `/passwords/agent/teams/${encodeURIComponent(teamId)}`;

/** The request headers of the contract. */
export const headers = {
  key: 'x-macro-user-api-key',
  wake: 'x-macro-agent-session-id',
  mutation: 'x-macro-passwords',
} as const;
