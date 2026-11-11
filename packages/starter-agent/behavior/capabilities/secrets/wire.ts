/**
 * The vault API's JSON, in one place: what its answers look like, and the
 * tagged selectors and secret payloads a request carries. The selector and
 * payload tags are provisional (the vault's typed-secret schema isn't frozen),
 * so nothing else spells them: swapping them is a change to this file only.
 */
import { z } from 'zod';

/** Every item kind the vault has. */
export const ItemKind = z.enum(['login', 'card', 'note', 'identity', 'api']);
export type ItemKind = z.infer<typeof ItemKind>;

/** The kinds an agent can create, and the one secret field each has besides a login's username. */
export const primaryFields = {
  login: 'password',
  api: 'key',
  note: 'text',
} as const;
export type CreatableKind = keyof typeof primaryFields;

/** The fields a secret can be copied from: a login's username and password, an API credential's key, a note's text. */
export type SecretField = 'username' | 'password' | 'key' | 'text';

// Provisional selector tags: one per (kind, field) an agent may copy.
const selectorTags = {
  login: { username: 'login_username', password: 'login_password' },
  api: { key: 'api_key' },
  note: { text: 'note_text' },
} as const;

type Tags = typeof selectorTags;
type SelectorTag = {
  [Kind in keyof Tags]: Tags[Kind][keyof Tags[Kind]];
}[keyof Tags];

const allTags: readonly [SelectorTag, ...SelectorTag[]] = [
  'login_username',
  'login_password',
  'api_key',
  'note_text',
];

export const SecretSelector = z.strictObject({ type: z.enum(allTags) });
export type SecretSelector = z.infer<typeof SecretSelector>;

const isCreatable = (kind: ItemKind): kind is CreatableKind =>
  kind in primaryFields;

/** The selector for one field of an item of `kind`, or undefined if that kind has no such field. */
export const selectorFor = (
  kind: ItemKind,
  field: SecretField
): SecretSelector | undefined => {
  if (!isCreatable(kind)) return undefined;
  const tags: Readonly<Partial<Record<SecretField, SelectorTag>>> =
    selectorTags[kind];
  const type = tags[field];
  return type === undefined ? undefined : { type };
};

/** The fields an item of `kind` can be copied from. */
export const fieldsOf = (kind: ItemKind): readonly SecretField[] =>
  (['username', 'password', 'key', 'text'] as const).filter(
    (field) => selectorFor(kind, field) !== undefined
  );

// Provisional typed secrets, one per creatable kind.
export const ItemSecret = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('login'),
    username: z.string().nullable(),
    password: z.string(),
  }),
  z.strictObject({ type: z.literal('api_credential'), key: z.string() }),
  z.strictObject({ type: z.literal('note'), text: z.string() }),
]);
export type ItemSecret = z.infer<typeof ItemSecret>;

export const ItemSecretPatch = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('login'),
    username: z.string().nullable().optional(),
    password: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('api_credential'),
    key: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('note'), text: z.string().optional() }),
]);
export type ItemSecretPatch = z.infer<typeof ItemSecretPatch>;

export const AgentEditableMetadata = z.strictObject({
  name: z.string().optional(),
  url: z.string().nullable().optional(),
});
export type AgentEditableMetadata = z.infer<typeof AgentEditableMetadata>;

/** What a new item's secret is: the kind's own field, and a login's username. */
export const itemSecret = (
  kind: CreatableKind,
  {
    username,
    primary,
  }: { readonly username?: string; readonly primary: string }
): ItemSecret =>
  kind === 'login'
    ? { type: 'login', username: username ?? null, password: primary }
    : kind === 'api'
      ? { type: 'api_credential', key: primary }
      : { type: 'note', text: primary };

/** A change to an item's secret, or undefined if nothing in it changes. */
export const itemSecretPatch = (
  kind: CreatableKind,
  {
    username,
    primary,
  }: { readonly username?: string; readonly primary?: string }
): ItemSecretPatch | undefined => {
  if (kind === 'login')
    return username === undefined && primary === undefined
      ? undefined
      : {
          type: 'login',
          ...(username === undefined ? {} : { username }),
          ...(primary === undefined ? {} : { password: primary }),
        };
  if (primary === undefined) return undefined;
  return kind === 'api'
    ? { type: 'api_credential', key: primary }
    : { type: 'note', text: primary };
};

/** The kind a secret payload is for, so it can be checked against its item's. */
export const kindOfSecret = (
  secret: ItemSecret | ItemSecretPatch
): CreatableKind =>
  secret.type === 'login'
    ? 'login'
    : secret.type === 'api_credential'
      ? 'api'
      : 'note';

/** The value a selector picks out of a secret (the stub vault's half of the selector contract). */
export const selected = (
  secret: ItemSecret,
  selector: SecretSelector
): string | undefined => {
  const { type } = selector;
  if (secret.type === 'login')
    return type === 'login_password'
      ? secret.password
      : type === 'login_username'
        ? (secret.username ?? undefined)
        : undefined;
  if (secret.type === 'api_credential')
    return type === 'api_key' ? secret.key : undefined;
  return type === 'note_text' ? secret.text : undefined;
};

/** A secret with a patch applied. */
export const patched = (
  secret: ItemSecret,
  patch: ItemSecretPatch
): ItemSecret => {
  if (secret.type === 'login' && patch.type === 'login')
    return {
      type: 'login',
      username: patch.username === undefined ? secret.username : patch.username,
      password: patch.password ?? secret.password,
    };
  if (secret.type === 'api_credential' && patch.type === 'api_credential')
    return { type: 'api_credential', key: patch.key ?? secret.key };
  if (secret.type === 'note' && patch.type === 'note')
    return { type: 'note', text: patch.text ?? secret.text };
  return secret;
};

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

export const TotpCode = z.object({
  code: z.string(),
  expiresAt: z.string(),
  periodSeconds: z.number().int(),
});

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
