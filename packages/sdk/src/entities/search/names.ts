import { match } from 'ts-pattern';
import type {
  NamedItem,
  NameKind,
  NameSearchResponse,
} from '../../../generated/search/types.gen';
import type { ChannelLabel } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent } from '../agents/agent';
import { Channel } from '../channels/channel';
import { Database } from '../databases/database';
import { Document } from '../documents/document';
import { Label } from '../email/label';
import { Initiative } from '../initiatives/initiative';
import { Project } from '../projects/project';
import { PropertyDefinition } from '../properties/property-definition';
import type { PropertyOption } from '../properties/property-option';
import { Task } from '../tasks/task';
import { User } from '../users/user';

export type { NameKind };

/** The most names one `macro.search.names` call looks up. */
export const MAX_NAMES = 10;

/** Every kind a name can name; the record keeps it in step with the server's. */
const NAME_KINDS = Object.keys({
  channel: true,
  person: true,
  project: true,
  initiative: true,
  document: true,
  task: true,
  database: true,
  agent: true,
  label: true,
  tag: true,
  channel_label: true,
} satisfies Record<NameKind, true>) as NameKind[];

/**
 * A name to look up: the name as the request uses it (`#design-feedback`,
 * `Q4 Launch`, `@Jordan`), and optionally the only kinds of item it may name.
 */
export type NameQuery = string | { name: string; kinds?: NameKind[] };

/**
 * An item a name matched, discriminated by `type`: `project` is a folder,
 * `initiative` what the app calls a project, `label` an email label, `tag` a
 * personal or team tag, `channel_label` a group of channels in the sidebar.
 */
export type NamedEntity =
  | { type: 'channel'; entity: Channel }
  | { type: 'person'; entity: User }
  | { type: 'project'; entity: Project }
  | { type: 'initiative'; entity: Initiative }
  | { type: 'document'; entity: Document }
  | { type: 'task'; entity: Task }
  | { type: 'database'; entity: Database }
  | { type: 'agent'; entity: Agent }
  | { type: 'label'; entity: Label }
  | { type: 'tag'; entity: PropertyOption }
  | { type: 'channel_label'; entity: ChannelLabel };

/** One item a name matched. */
export type NameMatch = NamedEntity & {
  /** The item's name as stored. */
  name: string;
  /**
   * Whether its name is the name looked up, ignoring case, surrounding space
   * and one leading `#` or `@`; for a person, their full name, first name or
   * email address.
   */
  exact: boolean;
};

/** What one name matched. */
export type NameResult = {
  /** The name as it was asked for. */
  name: string;
  /** Exact matches first (at most 10), then at most 5 whose name contains it. */
  matches: NameMatch[];
};

/** What each name matched, in the order asked. */
export type NamesLookup = {
  /** One result per name. */
  results: NameResult[];
  /**
   * Kinds that couldn't be looked in this time: a name with no match may
   * still name an item of one of these kinds.
   */
  unavailable: NameKind[];
};

/** Turn the lookup's wire response into handles. */
export async function namesLookup(
  client: MacroClient,
  response: NameSearchResponse,
): Promise<NamesLookup> {
  const items = response.results.flatMap((result) =>
    result.matches.map((m) => m.item),
  );
  const [tags, channelLabels] = await Promise.all([
    tagOptions(client, items),
    channelLabelsById(client, items),
  ]);
  return {
    results: response.results.map((result) => ({
      name: result.name,
      matches: result.matches.flatMap((m) => {
        const entity = namedEntity(client, m.item, tags, channelLabels);
        return entity ? [{ ...entity, name: m.name, exact: m.exact }] : [];
      }),
    })),
    unavailable: response.unavailable,
  };
}

function namedEntity(
  client: MacroClient,
  item: NamedItem,
  tags: Map<string, PropertyOption>,
  channelLabels: Map<string, ChannelLabel>,
): NamedEntity | undefined {
  return match(item)
    .returnType<NamedEntity | undefined>()
    .with({ kind: 'channel' }, ({ id }) => ({
      type: 'channel',
      entity: Channel.byId(client, id),
    }))
    .with({ kind: 'person' }, ({ id }) => ({
      type: 'person',
      entity: User.byId(client, id),
    }))
    .with({ kind: 'project' }, ({ id }) => ({
      type: 'project',
      entity: Project.byId(client, id),
    }))
    .with({ kind: 'initiative' }, ({ id }) => ({
      type: 'initiative',
      entity: Initiative.byId(client, id),
    }))
    .with({ kind: 'document' }, ({ id }) => ({
      type: 'document',
      entity: Document.byId(client, id),
    }))
    .with({ kind: 'task' }, ({ id }) => ({
      type: 'task',
      entity: Task.byId(client, id),
    }))
    .with({ kind: 'database' }, ({ id }) => ({
      type: 'database',
      entity: Database.byId(client, id),
    }))
    .with({ kind: 'agent' }, ({ id }) => ({
      type: 'agent',
      entity: Agent.byId(client, id),
    }))
    .with({ kind: 'label' }, ({ id }) => ({
      type: 'label',
      entity: Label.byId(client, id),
    }))
    .with({ kind: 'tag' }, ({ id }) => {
      const option = tags.get(id);
      return option ? { type: 'tag', entity: option } : undefined;
    })
    .with({ kind: 'channel_label' }, ({ id }) => {
      const label = channelLabels.get(id);
      return label ? { type: 'channel_label', entity: label } : undefined;
    })
    .exhaustive(() => undefined);
}

/** The matched tags' options, read from their tag sets (at most two). */
async function tagOptions(
  client: MacroClient,
  items: NamedItem[],
): Promise<Map<string, PropertyOption>> {
  const definitions = new Set(
    items.flatMap((item) => (item.kind === 'tag' ? [item.definitionId] : [])),
  );
  const options = await Promise.all(
    [...definitions].map((id) => PropertyDefinition.byId(client, id).options()),
  );
  return new Map(options.flat().map((option) => [option.id, option]));
}

/** The matched channel labels' records. */
async function channelLabelsById(
  client: MacroClient,
  items: NamedItem[],
): Promise<Map<string, ChannelLabel>> {
  if (!items.some((item) => item.kind === 'channel_label')) return new Map();
  const { labels } = unwrap(await client.storage.listChannelLabels());
  return new Map(labels.map((label) => [label.id, label]));
}

/** Parse the caller's names into the wire request, failing on a typo. */
export function nameQueries(
  names: NameQuery[],
  kinds: NameKind[] | undefined,
): { name: string; kinds: NameKind[] }[] {
  if (!Array.isArray(names) || names.length === 0)
    throw new Error('Pass at least one name to look up.');
  if (names.length > MAX_NAMES)
    throw new Error(
      `At most ${MAX_NAMES} names per call; split the rest into another call.`,
    );
  return names.map((query) => {
    const { name, kinds: own } =
      typeof query === 'string' ? { name: query, kinds: undefined } : query;
    if (typeof name !== 'string' || !name.trim())
      throw new Error('A name to look up must not be empty.');
    const queryKinds = own ?? kinds ?? [];
    if (
      !Array.isArray(queryKinds) ||
      queryKinds.some((kind) => !NAME_KINDS.includes(kind))
    )
      throw new Error(
        `Invalid name kinds. Supported values: ${NAME_KINDS.join(', ')}.`,
      );
    return { name, kinds: queryKinds };
  });
}
