import {
  type DefinitionNode,
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  type OperationDefinitionNode,
  parse,
  print,
  visit,
} from 'graphql';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The streamed cache sync's lane queries (`crates/soup_sync_stream`) select
 * what the app's cache stores, so they are built from the app's own GraphQL
 * documents: each lane's operation, from the app or from the catalog's
 * `operations/` when only the sync runs it, with every fragment it spreads
 * taken from the app and the client-only directives removed. A fragment the
 * app changes reaches the sync on the next generation; the test fails until
 * it is run.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const APP_DOCUMENTS = 'apps/web/src/lib/service-clients/service-storage/graphql';
const CLIENT_SCHEMA = 'apps/web/graphql-client-schema.graphql';
const CATALOG = 'crates/soup_sync_stream/src/catalog';
const CATALOG_OPERATIONS = `${CATALOG}/operations`;
const SCRIPT = 'apps/web/scripts/generate-sync-lane-queries.ts';

/** Each generated lane query file and the operation it runs. */
export const SYNC_LANE_QUERIES = [
  { file: 'calendar_occurrences.graphql', operation: 'CalendarOccurrences' },
  { file: 'channel_ids.graphql', operation: 'SoupSyncChannelIds' },
  { file: 'channels.graphql', operation: 'SoupBackfillSyncChannels' },
  { file: 'crm_contacts.graphql', operation: 'CrmContacts' },
  { file: 'document_ids.graphql', operation: 'SoupSyncDocumentIds' },
  { file: 'minimal_documents.graphql', operation: 'SoupBackfillSyncDocuments' },
  { file: 'minimal_tasks.graphql', operation: 'SoupBackfillSyncTasks' },
  { file: 'shared_email_ids.graphql', operation: 'SoupSyncSharedEmailIds' },
  { file: 'soup_backfill.graphql', operation: 'SoupBackfill' },
  { file: 'soup_mail_backfill.graphql', operation: 'SoupMailBackfill' },
  { file: 'task_ids.graphql', operation: 'SoupSyncTaskIds' },
  { file: 'task_project_ids.graphql', operation: 'SoupSyncTaskProjectIds' },
] as const;

type Definitions = {
  operations: Map<string, { node: OperationDefinitionNode; source: string }>;
  fragments: Map<string, FragmentDefinitionNode>;
};

function graphqlFiles(directory: string): string[] {
  return readdirSync(join(REPO, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return graphqlFiles(path);
      return entry.name.endsWith('.graphql') ? [path] : [];
    })
    .sort();
}

function collect(definitions: Definitions, path: string): void {
  const document = parse(readFileSync(join(REPO, path), 'utf8'));
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      const name = definition.name?.value;
      if (!name) throw new Error(`${path}: an anonymous operation`);
      if (definitions.operations.has(name)) {
        throw new Error(`${path}: operation ${name} is defined twice`);
      }
      definitions.operations.set(name, { node: definition, source: path });
    } else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      const name = definition.name.value;
      if (definitions.fragments.has(name)) {
        throw new Error(`${path}: fragment ${name} is defined twice`);
      }
      definitions.fragments.set(name, definition);
    }
  }
}

function readDefinitions(): Definitions {
  const definitions: Definitions = { operations: new Map(), fragments: new Map() };
  for (const path of graphqlFiles(APP_DOCUMENTS)) collect(definitions, path);
  for (const path of graphqlFiles(CATALOG_OPERATIONS)) collect(definitions, path);
  return definitions;
}

function clientOnlyDirectives(): Set<string> {
  const schema = parse(readFileSync(join(REPO, CLIENT_SCHEMA), 'utf8'));
  return new Set(
    schema.definitions
      .filter((definition) => definition.kind === Kind.DIRECTIVE_DEFINITION)
      .map((definition) => definition.name.value)
  );
}

function spreads(node: DefinitionNode): string[] {
  const names: string[] = [];
  visit(node, {
    FragmentSpread(spread) {
      names.push(spread.name.value);
    },
  });
  return names;
}

/** The operation and every fragment it reaches, in order of first use. */
function lane(definitions: Definitions, operation: string): DocumentNode {
  const entry = definitions.operations.get(operation);
  if (!entry) throw new Error(`no operation ${operation}`);
  const fragments: FragmentDefinitionNode[] = [];
  const seen = new Set<string>();
  const queue = spreads(entry.node);
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const fragment = definitions.fragments.get(name);
    if (!fragment) throw new Error(`${operation}: no fragment ${name}`);
    fragments.push(fragment);
    queue.push(...spreads(fragment));
  }
  return { kind: Kind.DOCUMENT, definitions: [entry.node, ...fragments] };
}

/** Every lane query file's path and generated contents. */
export function renderSyncLaneQueries(): { path: string; contents: string }[] {
  const definitions = readDefinitions();
  const clientOnly = clientOnlyDirectives();
  return SYNC_LANE_QUERIES.map(({ file, operation }) => {
    const document = visit(lane(definitions, operation), {
      Directive(directive) {
        return clientOnly.has(directive.name.value) ? null : undefined;
      },
    });
    const source = definitions.operations.get(operation)?.source ?? '';
    return {
      path: `${CATALOG}/${file}`,
      contents: [
        `# Generated by ${SCRIPT}; do not edit.`,
        `# Operation from ${source}; fragments from ${APP_DOCUMENTS}.`,
        '',
        `${print(document)}`,
        '',
      ].join('\n'),
    };
  });
}

/** Lane query files whose contents differ from what generation writes. */
export function staleSyncLaneQueries(): string[] {
  return renderSyncLaneQueries()
    .filter(({ path, contents }) => {
      try {
        return readFileSync(join(REPO, path), 'utf8') !== contents;
      } catch {
        return true;
      }
    })
    .map(({ path }) => path);
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    const stale = staleSyncLaneQueries();
    if (stale.length > 0) {
      console.error(
        `Stale sync lane queries (run \`bun run gen-sync-lane-queries\` in apps/web):\n${stale.join('\n')}`
      );
      process.exit(1);
    }
  } else {
    for (const { path, contents } of renderSyncLaneQueries()) {
      writeFileSync(join(REPO, path), contents);
      console.log(`wrote ${relative(REPO, join(REPO, path))}`);
    }
  }
}
