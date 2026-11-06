// Finds the items a routine description names, as the person, with their
// access. Runs as a dry run: it only reads. The names arrive as JSON in the
// `lookups` knob. Each name gets the items whose name contains it, at most
// MAX_MATCHES; the drafter decides which, if any, the name means. A name
// whose SDK call failed comes back `failed`, with no matches.

type Kind = 'channel' | 'person' | 'folder' | 'label' | 'tag' | 'agent';
type Lookup = { kind: Kind; name: string };
type Match = { name: string; id: string; definitionId?: string };

const MAX_MATCHES = 5;

async function take<T>(items: AsyncIterable<T>, limit: number): Promise<T[]> {
  const taken: T[] = [];
  for await (const item of items) {
    taken.push(item);
    if (taken.length >= limit) break;
  }
  return taken;
}

function contains(name: string | undefined, query: string): boolean {
  return (name ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export async function main({ macro, knobs }: StepContext) {
  const lookups: Lookup[] = JSON.parse(knobs.lookups);
  // Lists are read once, however many names need them.
  let labels: Promise<Match[]> | undefined;
  let tags: Promise<Match[]> | undefined;
  let agents: Promise<Match[]> | undefined;
  const allLabels = () =>
    (labels ??= macro.email.labels().then((found) =>
      Promise.all(
        found.map(async (label) => ({ name: (await label.name()) ?? '', id: label.id })),
      ),
    ));
  const allTags = () =>
    (tags ??= macro.properties.tags().then((sets) =>
      sets.flatMap((set) =>
        set.options.flatMap((option) =>
          option.value.type === 'string'
            ? [{ name: option.value.value, id: option.id, definitionId: option.propertyDefinitionId }]
            : [],
        ),
      ),
    ));
  const allAgents = () =>
    (agents ??= macro.agents.list().then((found) =>
      Promise.all(
        found.map(async (agent) => ({ name: (await agent.name()) ?? '', id: agent.id })),
      ),
    ));
  const named = async <T extends { id: string; name(): Promise<string | undefined> }>(
    items: T[],
  ): Promise<Match[]> =>
    Promise.all(items.map(async (item) => ({ name: (await item.name()) ?? '', id: item.id })));

  const find = async ({ kind, name }: Lookup): Promise<Match[]> => {
    switch (kind) {
      case 'channel':
        return named(await take(macro.channels.search(name.replace(/^#/, '')), MAX_MATCHES));
      case 'person':
        return named((await macro.users.search(name.replace(/^@/, ''))).slice(0, MAX_MATCHES));
      case 'folder':
        return named(await take(macro.projects.search(name), MAX_MATCHES));
      case 'label':
        return (await allLabels()).filter((label) => contains(label.name, name)).slice(0, MAX_MATCHES);
      case 'tag':
        return (await allTags()).filter((tag) => contains(tag.name, name)).slice(0, MAX_MATCHES);
      case 'agent':
        return (await allAgents()).filter((agent) => contains(agent.name, name.replace(/^@/, ''))).slice(0, MAX_MATCHES);
    }
  };

  // One failed lookup leaves only that name unresolved.
  return Promise.all(
    lookups.map(async (lookup) => {
      try {
        return { ...lookup, matches: await find(lookup), failed: false };
      } catch {
        return { ...lookup, matches: [], failed: true };
      }
    }),
  );
}
