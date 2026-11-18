/**
 * Secrets: the team's vault in Macro, as the agent may use it. It finds
 * items by name, puts one field of one on the clipboard, makes and changes
 * its own, and asks the owner for the rest. No function here gives a value
 * back: a value goes from the vault to the clipboard, or from the clipboard
 * (or the agent's own input) to the vault, inside the script's process.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import type { Base } from '../../context/index.ts';
import { addPending } from './access.ts';
import {
  clipboard as clipboardLimits,
  code,
  logStream,
  searchLimit,
} from './config.ts';
import type { SecretsPorts } from './ports.ts';
import type { Refusal } from './vault.ts';
import {
  type AccessStatus,
  type AgentKind,
  type AgentSearchHit,
  fieldsOf,
  type ItemKind,
  type ItemSecret,
  type ItemSecretPatch,
  isAgentKind,
  kindFields,
  type Permission,
  type SecretField,
  selectorFor,
} from './wire.ts';

export type { SecretsPorts } from './ports.ts';

/** The parts of the context the secrets functions read. */
export type Needs = { readonly secrets: SecretsPorts } & Pick<
  Base,
  'disk' | 'join' | 'state' | 'log'
>;

/** An item in the team's vault, as a search finds it: never a value. */
export type SecretHit = {
  readonly teamId: string;
  readonly itemId: string;
  readonly name: string;
  readonly kind: ItemKind;
  readonly url: string | null;
  /** `usable`: copy away. `request_access`: ask with requestSecretAccess. `pending`: asked; you'll be woken. */
  readonly access: AccessStatus;
  readonly canUpdate: boolean;
  /** Its version when it was found: a copy or update of a changed item is refused, so search again. */
  readonly version: number;
  /** The fields copySecret can copy from it: a login's username and password, an API credential's key and secret, nothing of any other kind. */
  readonly fields: readonly SecretField[];
};

/** An item to act on: a search hit, or at least its ids, name and kind. */
export type SecretItem = Pick<
  SecretHit,
  'teamId' | 'itemId' | 'name' | 'kind'
> &
  Partial<Omit<SecretHit, 'teamId' | 'itemId' | 'name' | 'kind'>>;

/** A secret to write: the text itself, which you then see, or what is on the clipboard, which you never do. */
export type SecretInput = string | { readonly fromClipboard: true };

const kindNames: Record<ItemKind, string> = {
  login: 'a login',
  api: 'an API credential',
  note: 'a note',
  card: 'a card',
  identity: 'an identity',
  verification_code: 'a verification code',
};

const agentKinds = 'only logins and API credentials';

/** What the agent is told when the vault refuses. Never anything the vault sent but its code. */
export const refusal = (
  refused: Refusal,
  {
    name,
    scope,
    doing,
    field,
    retryAfterMs,
  }: {
    readonly name: string;
    readonly scope: 'team' | 'item';
    readonly doing: string;
    readonly field?: SecretField;
    readonly retryAfterMs?: number;
  }
): string => {
  const minutes =
    retryAfterMs === undefined
      ? undefined
      : Math.max(1, Math.ceil(retryAfterMs / 60_000));
  const messages: Record<Refusal, string> = {
    unauthorized: 'the vault refused your Macro key',
    invalid_agent: "the vault doesn't admit you as an agent of your team",
    invalid_session_attribution:
      "the vault refused this wake's id, which the running agent sets: a bug in the agent, not something to retry",
    // The vault answers a feature that is off as it answers a missing item.
    not_found:
      scope === 'team'
        ? "secrets aren't turned on for this team"
        : `no secret "${name}" in your team's vault, or secrets aren't turned on for this team`,
    not_granted: `you have no access to "${name}": ask your owner for it with requestSecretAccess`,
    pending: `access to "${name}" is waiting on your owner's approval: you are woken when it is decided`,
    forbidden: `you may not ${doing} "${name}"`,
    invalid_request: `the vault refused the request to ${doing} "${name}" as malformed`,
    unsupported_kind: `agents can't use "${name}": ${agentKinds}`,
    field_not_set: `"${name}" has no ${field ?? 'value in that field'}`,
    rate_limited: `you have asked for access too often: you can ask for "${name}" again ${minutes === undefined ? 'later' : `in about ${minutes} min`}`,
    version_conflict: `"${name}" changed since you last saw it: search for it again, and use the new hit`,
    vault_busy: 'the vault is busy: try again in a minute',
    vault_unavailable: 'the vault is unavailable right now: try again later',
    unexpected: "the vault answered in a way this agent doesn't understand",
    unreachable: "the vault couldn't be reached",
  };
  return messages[refused];
};

const hitOf = (teamId: string, hit: AgentSearchHit): SecretHit => ({
  teamId,
  itemId: hit.id,
  name: hit.name,
  kind: hit.kind,
  url: hit.url,
  access: hit.access.status,
  canUpdate: hit.access.canUpdate,
  version: hit.version,
  fields: fieldsOf(hit.kind),
});

/** One line in the secrets log: opaque ids, the selector and the outcome, never a name or value. */
const record = (
  context: Pick<Needs, 'log'>,
  entry: {
    readonly op: string;
    readonly item?: string;
    readonly selector?: string;
    readonly wake: string;
    readonly outcome: string;
  }
): Promise<void> => context.log.event(logStream, entry);

const unusableKind = (kind: ItemKind, doing: string): string =>
  `you can't ${doing} ${kindNames[kind]}: ${agentKinds}`;

const noSuchField = (kind: AgentKind, field: string): string =>
  `${kindNames[kind]} has no ${field}: its fields are ${kindFields[kind].join(', ')}`;

/**
 * The text of each field given, the clipboard's for the one that asks for it.
 * The clipboard holds one value, so at most one field can come from it.
 */
const resolved = async <Field extends string>(
  { clipboard }: SecretsPorts,
  given: Readonly<Partial<Record<Field, SecretInput>>>,
  empty: (field: Field) => string
): Promise<Partial<Record<Field, string>>> => {
  const entries = Object.entries(given).filter(
    (entry): entry is [Field, SecretInput] => entry[1] !== undefined
  );
  if (entries.filter(([, input]) => typeof input !== 'string').length > 1)
    throw new Error(
      'only one field can come from the clipboard: it holds one value'
    );
  const texts: Partial<Record<Field, string>> = {};
  for (const [field, input] of entries) {
    const text = typeof input === 'string' ? input : await clipboard.take();
    if (text === '') throw new Error(empty(field));
    texts[field] = text;
  }
  return texts;
};

/**
 * Finds items in your team's vault by name: never their values.
 *
 * Each hit says whether you can use it (`access`): `usable` (copy it),
 * `request_access` (ask your owner with requestSecretAccess) or `pending`
 * (asked; you are woken when it is decided), and which `fields` copySecret
 * can copy. Pass a hit as `item` to the other functions. `query` matches
 * names; leave it out to list them. `limit` is 1 to 100, 50 by default.
 */
export const searchSecrets = async (
  context: Needs,
  { query, limit }: { readonly query?: string; readonly limit?: number } = {}
): Promise<readonly SecretHit[]> => {
  const most = limit ?? searchLimit.default;
  if (!Number.isInteger(most) || most < 1 || most > searchLimit.most)
    throw new Error(`limit: a whole number from 1 to ${searchLimit.most}`);
  const { vault } = context.secrets;
  const teamId = await vault.team();
  const answer = await vault.search(teamId, {
    query: (query ?? '').trim(),
    limit: most,
  });
  await record(context, {
    op: 'search',
    wake: answer.wake,
    outcome: answer.kind === 'ok' ? 'found' : answer.code,
  });
  if (answer.kind === 'refused')
    throw new Error(
      refusal(answer.code, { name: '', scope: 'team', doing: 'search' })
    );
  return answer.value.items.map((hit) => hitOf(teamId, hit));
};

/**
 * Puts one field of an item on the computer's clipboard, to paste where it
 * is needed. You never see the value; this returns only "Copied <name> <field>".
 *
 * `field` is one of the item's `fields`: a login's `username` or `password`,
 * an API credential's `key` or `secret`. Nothing else can be copied. The
 * clipboard holds it for 20 seconds or one paste, whichever is first, and
 * the next copy replaces it. Paste it with the computer's paste keys
 * (ctrl+v) into the focused field. An item you created is always usable;
 * any other needs your owner's approval once (requestSecretAccess).
 */
export const copySecret = async (
  context: Needs,
  { item, field }: { readonly item: SecretItem; readonly field: SecretField }
): Promise<`Copied ${string}`> => {
  const { kind } = item;
  if (!isAgentKind(kind)) throw new Error(unusableKind(kind, 'copy from'));
  const selector = selectorFor(kind, field);
  if (selector === undefined) throw new Error(noSuchField(kind, field));
  const { vault, clipboard } = context.secrets;
  const answer = await vault.disclose(item.teamId, item.itemId, {
    selector,
    ...(item.version === undefined ? {} : { expectedVersion: item.version }),
  });
  const entry = {
    op: 'copy',
    item: item.itemId,
    selector: `${selector.kind}.${selector.field}`,
  };
  if (answer.kind === 'refused') {
    await record(context, {
      ...entry,
      wake: answer.wake,
      outcome: answer.code,
    });
    throw new Error(
      refusal(answer.code, {
        name: item.name,
        scope: 'item',
        doing: 'copy',
        field,
      })
    );
  }
  await clipboard.put(answer.value.value);
  await record(context, { ...entry, wake: answer.wake, outcome: 'copied' });
  return `Copied ${item.name} ${field}`;
};

/**
 * Puts an item's current one-time (TOTP) code on the clipboard, as
 * copySecret does a field. You never see the code or its seed; this returns
 * "Copied code for <name>, valid for about N s": the clipboard holds it that
 * long (or until its one paste), and no longer than the code is good for,
 * so paste it straight away.
 */
export const copySecretCode = async (
  context: Needs,
  { item }: { readonly item: SecretItem }
): Promise<`Copied code for ${string}`> => {
  const { vault, clipboard, monotonic } = context.secrets;
  const entry = { op: 'code', item: item.itemId };
  // Timed from the first request, through every retry: the vault's validForMs
  // is as of its answer, and this side's share of the round trip is unknown.
  const sent = monotonic();
  let wake = '';
  for (let attempt = 0; attempt < code.attempts; attempt += 1) {
    const answer = await vault.totpCode(item.teamId, item.itemId);
    wake = answer.wake;
    if (answer.kind === 'refused') {
      await record(context, { ...entry, wake, outcome: answer.code });
      throw new Error(
        refusal(answer.code, {
          name: item.name,
          scope: 'item',
          doing: 'get a code for',
        })
      );
    }
    const elapsed = Math.ceil(monotonic() - sent);
    const left = answer.value.validForMs - elapsed;
    if (left < code.spareMs) continue;
    const ttlMs = Math.min(clipboardLimits.seconds * 1000, left - code.spareMs);
    await clipboard.put(answer.value.code, ttlMs);
    await record(context, { ...entry, wake, outcome: 'copied' });
    return `Copied code for ${item.name}, valid for about ${Math.floor(ttlMs / 1000)} s`;
  }
  await record(context, { ...entry, wake, outcome: 'too_late' });
  throw new Error(
    `the code for "${item.name}" was too close to expiring to paste: try again`
  );
};

/** A new item's kind and secret: a login's password (and username), or an API credential's secret (and key). */
export type NewSecret =
  | {
      readonly kind: 'login';
      readonly username?: SecretInput;
      readonly password: SecretInput;
    }
  | {
      readonly kind: 'api';
      readonly key?: SecretInput;
      readonly secret: SecretInput;
    };

/**
 * Stores a new item in your team's vault, which you can use at once.
 *
 * `kind` is `login` (a `password`, and a `username` if it has one) or `api`
 * (a `secret`, and a `key` if it has one). Each is the text itself, which
 * is then visible to you and in your transcript, or `{ fromClipboard: true }`
 * for what is on the clipboard (a generated password you copied from a
 * page), which never passes through you; one field at most can come from
 * the clipboard. Returns the new item and its version, never a value.
 */
export const createSecret = async (
  context: Needs,
  input: { readonly name: string; readonly url?: string } & NewSecret
): Promise<{ readonly item: SecretHit; readonly version: number }> => {
  const named = input.name.trim();
  if (named === '') throw new Error('name: empty');
  const empty = (field: string) => `${field}: empty`;
  const secret: ItemSecret =
    input.kind === 'login'
      ? await (async () => {
          const { username, password } = await resolved(
            context.secrets,
            { username: input.username, password: input.password },
            empty
          );
          if (password === undefined) throw new Error(empty('password'));
          return {
            kind: 'login' as const,
            ...(username === undefined ? {} : { username }),
            password,
          };
        })()
      : await (async () => {
          const { key, secret } = await resolved(
            context.secrets,
            { key: input.key, secret: input.secret },
            empty
          );
          if (secret === undefined) throw new Error(empty('secret'));
          return {
            kind: 'api' as const,
            ...(key === undefined ? {} : { key }),
            secret,
          };
        })();
  const { vault } = context.secrets;
  const teamId = await vault.team();
  const answer = await vault.create(teamId, {
    name: named,
    url: input.url ?? null,
    secret,
  });
  if (answer.kind === 'refused') {
    await record(context, {
      op: 'create',
      wake: answer.wake,
      outcome: answer.code,
    });
    throw new Error(
      refusal(answer.code, { name: named, scope: 'team', doing: 'create' })
    );
  }
  const item = hitOf(teamId, answer.value.item);
  await record(context, {
    op: 'create',
    item: item.itemId,
    wake: answer.wake,
    outcome: 'created',
  });
  return { item, version: answer.value.version };
};

/**
 * Changes an item you may edit: one you created, or one your owner gave you
 * edit access to.
 *
 * Give any of its fields (a login's `username` and `password`, an API
 * credential's `key` and `secret`), each as in createSecret, and a new
 * `name` or `url`. A field you leave out stays as it is; none can be
 * cleared. `item` is a hit from searchSecrets (or what createSecret or
 * updateSecret returned): its `version` is the one you saw, and the vault
 * refuses to change an item that has changed since, so search again.
 * Returns the item at its new version.
 */
export const updateSecret = async (
  context: Needs,
  {
    item,
    name,
    url,
    ...fields
  }: {
    readonly item: SecretItem;
    readonly username?: SecretInput;
    readonly password?: SecretInput;
    readonly key?: SecretInput;
    readonly secret?: SecretInput;
    readonly name?: string;
    readonly url?: string | null;
  }
): Promise<{ readonly item: SecretHit; readonly version: number }> => {
  const { kind, version: expectedVersion } = item;
  if (!isAgentKind(kind)) throw new Error(unusableKind(kind, 'change'));
  const own: readonly string[] = kindFields[kind];
  const given = Object.entries(fields).filter(
    ([, input]) => input !== undefined
  );
  const foreign = given.find(([field]) => !own.includes(field));
  if (foreign !== undefined) throw new Error(noSuchField(kind, foreign[0]));
  if (given.length === 0 && name === undefined && url === undefined)
    throw new Error(
      `nothing to change: give ${[...own, 'name'].join(', ')} or url`
    );
  if (name !== undefined && name.trim() === '') throw new Error('name: empty');
  if (expectedVersion === undefined)
    throw new Error(
      `search for "${item.name}" first: an update says which version it changes, so it can't overwrite a change you haven't seen`
    );
  const texts = await resolved(
    context.secrets,
    fields,
    (field) => `${field}: empty (a field can't be cleared)`
  );
  const secretPatch: ItemSecretPatch | undefined =
    Object.keys(texts).length === 0
      ? undefined
      : kind === 'login'
        ? {
            kind,
            ...(texts.username === undefined
              ? {}
              : { username: texts.username }),
            ...(texts.password === undefined
              ? {}
              : { password: texts.password }),
          }
        : {
            kind,
            ...(texts.key === undefined ? {} : { key: texts.key }),
            ...(texts.secret === undefined ? {} : { secret: texts.secret }),
          };
  const metadataPatch =
    name === undefined && url === undefined
      ? undefined
      : {
          ...(name === undefined ? {} : { name: name.trim() }),
          ...(url === undefined ? {} : { url }),
        };
  const answer = await context.secrets.vault.update(item.teamId, item.itemId, {
    expectedVersion,
    ...(secretPatch === undefined ? {} : { secretPatch }),
    ...(metadataPatch === undefined ? {} : { metadataPatch }),
  });
  const entry = { op: 'update', item: item.itemId };
  if (answer.kind === 'refused') {
    await record(context, {
      ...entry,
      wake: answer.wake,
      outcome: answer.code,
    });
    throw new Error(
      refusal(answer.code, { name: item.name, scope: 'item', doing: 'change' })
    );
  }
  await record(context, { ...entry, wake: answer.wake, outcome: 'updated' });
  return {
    item: hitOf(item.teamId, answer.value.item),
    version: answer.value.version,
  };
};

/**
 * Asks your owner for an item you can't use yet: they get a one-click
 * approval, and you are woken when they decide. Returns "Requested" (also
 * when you had already asked), or "Already usable".
 *
 * `permission` is `view` (copy it; the default) or `edit` (also change it).
 * Say in the conversation what you need it for, so your owner knows.
 */
export const requestSecretAccess = async (
  context: Needs,
  {
    item,
    permission,
  }: { readonly item: SecretItem; readonly permission?: Permission }
): Promise<'Requested' | 'Already usable'> => {
  const { vault, polling } = context.secrets;
  const answer = await vault.requestAccess(
    item.teamId,
    item.itemId,
    permission ?? 'view'
  );
  const entry = { op: 'request', item: item.itemId };
  if (answer.kind === 'refused') {
    await record(context, {
      ...entry,
      wake: answer.wake,
      outcome: answer.code,
    });
    throw new Error(
      refusal(answer.code, {
        name: item.name,
        scope: 'item',
        doing: 'ask for',
        retryAfterMs: answer.retryAfterMs,
      })
    );
  }
  if (answer.value.access.status === 'usable') {
    await record(context, { ...entry, wake: answer.wake, outcome: 'usable' });
    return 'Already usable';
  }
  await addPending(context, {
    teamId: item.teamId,
    itemId: item.itemId,
    name: item.name,
    revision: answer.value.revision,
  });
  await polling.ensure();
  await record(context, { ...entry, wake: answer.wake, outcome: 'requested' });
  return 'Requested';
};

export const secretsModule = module({
  name: 'secrets',
  summary:
    "Your team's vault: find items by name, copy a field or a code to the clipboard, store and change your own, and ask your owner for the rest. You never see a value.",
  docs: [
    'Search first, and pass a hit as `item`. Only logins (username, password) and API credentials (key, secret) can be copied or written; other kinds show in search only. Nothing returns a value: copySecret and copySecretCode put it on the computer clipboard for one paste or 20 seconds (a code for less, as it says), so copy right before you paste, and paste with ctrl+v into the field that needs it.',
    "Items you create are usable at once. Anything else needs your owner's approval once: requestSecretAccess, and you are woken when they decide.",
    'To store a secret a page showed or generated, copy it there and give that field as { fromClipboard: true }, so it never passes through you.',
  ].join('\n\n'),
  file: import.meta.path,
  functions: {
    searchSecrets,
    copySecret,
    copySecretCode,
    createSecret,
    updateSecret,
    requestSecretAccess,
  },
});

export const secretsCapabilities = behavior<Needs>().capability(secretsModule);
