/**
 * Secrets: the team's vault in Macro, as the agent may use it. It finds
 * items by name, puts one field of one on the clipboard, makes and changes
 * its own, and asks the owner for the rest. No function here gives a value
 * back: a value goes from the vault to the clipboard, or from the clipboard
 * (or the agent's own input) to the vault, inside the script's process.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import { z } from 'zod';
import type { Base } from '../../context/index.ts';
import { addPending } from './access.ts';
import { logStream, owner, searchLimit, versionsFile } from './config.ts';
import type { SecretsPorts } from './ports.ts';
import type { Refusal } from './vault.ts';
import {
  type AccessStatus,
  type AgentSearchHit,
  type CreatableKind,
  fieldsOf,
  type ItemKind,
  itemSecret,
  itemSecretPatch,
  type Permission,
  primaryFields,
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
  /** The fields copySecret can copy from it. */
  readonly fields: readonly SecretField[];
};

/** An item to act on: a search hit, or at least its ids, name and kind. */
export type SecretItem = Pick<
  SecretHit,
  'teamId' | 'itemId' | 'name' | 'kind'
> &
  Partial<Omit<SecretHit, 'teamId' | 'itemId' | 'name' | 'kind'>>;

const kindNames: Record<ItemKind, string> = {
  login: 'a login',
  api: 'an API credential',
  note: 'a note',
  card: 'a card',
  identity: 'an identity',
};

/** What the agent is told when the vault refuses. Never anything the vault sent but its code. */
export const refusal = (
  code: Refusal,
  {
    name,
    scope,
    doing,
  }: {
    readonly name: string;
    readonly scope: 'team' | 'item';
    readonly doing: string;
  }
): string => {
  const messages: Record<Refusal, string> = {
    unauthorized: 'the vault refused your Macro key',
    invalid_agent: "the vault doesn't admit you as an agent of your team",
    invalid_session_attribution:
      "the vault refused this wake's id, which the running agent sets: a bug in the agent, not something to retry",
    // The vault answers a feature that is off as it answers a missing item.
    not_found:
      scope === 'team'
        ? "secrets aren't turned on for this team"
        : `no secret "${name}" in your team's vault (or secrets aren't turned on for this team)`,
    not_granted: `you have no access to "${name}": ask your owner for it with requestSecretAccess`,
    pending: `access to "${name}" is waiting on your owner's approval: you are woken when it is decided`,
    forbidden: `you may not ${doing} "${name}"`,
    invalid_request: `the vault refused the request to ${doing} "${name}" as malformed`,
    version_conflict: `"${name}" changed since you last saw it: copy one of its fields to see the current version, then try again`,
    vault_busy: 'the vault is busy: try again in a minute',
    vault_unavailable: 'the vault is unavailable right now: try again later',
    unexpected: "the vault answered in a way this agent doesn't understand",
    unreachable: "the vault couldn't be reached",
  };
  return messages[code];
};

const hitOf = (teamId: string, hit: AgentSearchHit): SecretHit => ({
  teamId,
  itemId: hit.id,
  name: hit.name,
  kind: hit.kind,
  url: hit.url,
  access: hit.access.status,
  canUpdate: hit.access.canUpdate,
  fields: fieldsOf(hit.kind),
});

const Versions = z.record(z.string(), z.number().int());

const versionsPath = ({ join, state }: Pick<Needs, 'join' | 'state'>) =>
  join(state.run(owner), versionsFile);

const versions = async (
  context: Pick<Needs, 'disk' | 'join' | 'state'>
): Promise<Readonly<Record<string, number>>> => {
  const text = await context.disk.read(versionsPath(context));
  if (text === undefined) return {};
  try {
    const parsed = Versions.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

/** The version of an item the agent last saw, so an update says which one it changes. */
const remember = async (
  context: Pick<Needs, 'disk' | 'join' | 'state'>,
  itemId: string,
  version: number
): Promise<void> =>
  context.disk.write(
    versionsPath(context),
    `${JSON.stringify({ ...(await versions(context)), [itemId]: version })}\n`
  );

/** One line in the secrets log: opaque ids, the selector's kind and the outcome, never a name or value. */
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

const isCreatable = (kind: ItemKind): kind is CreatableKind =>
  kind in primaryFields;

/** The value a write takes: given, or the clipboard's. */
const valueFrom = async (
  { clipboard }: SecretsPorts,
  {
    value,
    fromClipboard,
  }: { readonly value?: string; readonly fromClipboard?: true }
): Promise<string | undefined> => {
  if (value !== undefined && fromClipboard !== undefined)
    throw new Error('give at most one of value and fromClipboard');
  if (fromClipboard === undefined) return value;
  const taken = await clipboard.take();
  if (taken === '') throw new Error('the clipboard is empty');
  return taken;
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
 * an API credential's `key`, a note's `text`. The clipboard holds it for 20
 * seconds or one paste, whichever is first, and the next copy replaces it.
 * Paste it with the computer's paste keys (ctrl+v) into the focused field.
 * An item you created is always usable; any other needs your owner's
 * approval once (requestSecretAccess).
 */
export const copySecret = async (
  context: Needs,
  { item, field }: { readonly item: SecretItem; readonly field: SecretField }
): Promise<`Copied ${string}`> => {
  const selector = selectorFor(item.kind, field);
  if (selector === undefined) {
    const fields = fieldsOf(item.kind);
    throw new Error(
      `${kindNames[item.kind]} has no ${field}: ${fields.length === 0 ? "its fields can't be copied yet" : `its fields are ${fields.join(', ')}`}`
    );
  }
  const { vault, clipboard } = context.secrets;
  const answer = await vault.disclose(item.teamId, item.itemId, { selector });
  const entry = { op: 'copy', item: item.itemId, selector: selector.type };
  if (answer.kind === 'refused') {
    await record(context, {
      ...entry,
      wake: answer.wake,
      outcome: answer.code,
    });
    throw new Error(
      refusal(answer.code, { name: item.name, scope: 'item', doing: 'copy' })
    );
  }
  await clipboard.put(answer.value.value);
  await remember(context, item.itemId, answer.value.version);
  await record(context, { ...entry, wake: answer.wake, outcome: 'copied' });
  return `Copied ${item.name} ${field}`;
};

/**
 * Puts an item's current one-time (TOTP) code on the clipboard, as
 * copySecret does a field. You never see the code or its seed; this returns
 * only "Copied code for <name>". The code is good until its 30-second window
 * ends, so paste it straight away.
 */
export const copySecretCode = async (
  context: Needs,
  { item }: { readonly item: SecretItem }
): Promise<`Copied code for ${string}`> => {
  const { vault, clipboard } = context.secrets;
  const answer = await vault.totpCode(item.teamId, item.itemId);
  const entry = { op: 'code', item: item.itemId };
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
        doing: 'get a code for',
      })
    );
  }
  await clipboard.put(answer.value.code);
  await record(context, { ...entry, wake: answer.wake, outcome: 'copied' });
  return `Copied code for ${item.name}`;
};

/**
 * Stores a new item in your team's vault, which you can use at once and
 * your owner owns.
 *
 * `kind` is `login` (a `username` and a password), `api` (a key) or `note`
 * (text). Give the secret as exactly one of `value` or `fromClipboard: true`.
 * A `value` you write is visible to you and in your transcript: when the
 * secret is on the clipboard (a generated password you copied from a page),
 * use `fromClipboard` so it never passes through you. Returns the new item
 * and its version, never the value.
 */
export const createSecret = async (
  context: Needs,
  {
    name,
    kind,
    url,
    username,
    value,
    fromClipboard,
  }: {
    readonly name: string;
    readonly kind: CreatableKind;
    readonly url?: string;
    readonly username?: string;
    readonly value?: string;
    readonly fromClipboard?: true;
  }
): Promise<{ readonly item: SecretHit; readonly version: number }> => {
  const named = name.trim();
  if (named === '') throw new Error('name: empty');
  if (value === undefined && fromClipboard === undefined)
    throw new Error('give the secret as value or fromClipboard: true');
  const primary = await valueFrom(context.secrets, { value, fromClipboard });
  if (primary === undefined || primary === '')
    throw new Error('the secret is empty');
  const { vault } = context.secrets;
  const teamId = await vault.team();
  const answer = await vault.create(teamId, {
    name: named,
    kind,
    url: url ?? null,
    secret: itemSecret(kind, { username, primary }),
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
  await remember(context, item.itemId, answer.value.version);
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
 * Give any of: the secret as `value` or `fromClipboard: true` (as in
 * createSecret), a login's `username`, a new `name` or `url`. The vault
 * refuses to change a version you haven't seen: `version` is the one you
 * last saw, and is remembered from your last copy, create or update of the
 * item when you leave it out. Returns the item and its new version.
 */
export const updateSecret = async (
  context: Needs,
  {
    item,
    value,
    fromClipboard,
    username,
    name,
    url,
    version,
  }: {
    readonly item: SecretItem;
    readonly value?: string;
    readonly fromClipboard?: true;
    readonly username?: string;
    readonly name?: string;
    readonly url?: string | null;
    readonly version?: number;
  }
): Promise<{ readonly item: SecretHit; readonly version: number }> => {
  const { kind } = item;
  if (!isCreatable(kind))
    throw new Error(`${kindNames[kind]} can't be changed here yet`);
  if (
    [value, fromClipboard, username, name, url].every(
      (change) => change === undefined
    )
  )
    throw new Error(
      'nothing to change: give a value, fromClipboard, username, name or url'
    );
  if (name !== undefined && name.trim() === '') throw new Error('name: empty');
  const expectedVersion = version ?? (await versions(context))[item.itemId];
  if (expectedVersion === undefined)
    throw new Error(
      `you haven't seen a version of "${item.name}" yet: copy one of its fields first, so this can't overwrite a change you haven't seen`
    );
  const primary = await valueFrom(context.secrets, { value, fromClipboard });
  if (primary === '') throw new Error('the secret is empty');
  const secretPatch = itemSecretPatch(kind, { username, primary });
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
  await remember(context, item.itemId, answer.value.version);
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
    'Search first, and pass a hit as `item`. Nothing returns a value: copySecret and copySecretCode put it on the computer clipboard for one paste or 20 seconds, so copy right before you paste, and paste with ctrl+v into the field that needs it.',
    "Items you create are usable at once. Anything else needs your owner's approval once: requestSecretAccess, and you are woken when they decide.",
    'To store a secret a page showed or generated, copy it there and use fromClipboard: true, so it never passes through you.',
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
