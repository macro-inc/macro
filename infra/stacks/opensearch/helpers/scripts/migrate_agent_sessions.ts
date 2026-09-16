/** Repair agent indexing for future writes only; never reindex or backfill.
 * Run with ENVIRONMENT=prod and the usual OPENSEARCH_* connection variables.
 * Defaults to dry-run; DRY_RUN=false applies the printed plan.
 */
import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  AGENT_SESSIONS_ALIAS,
  AGENT_SESSIONS_INDEX,
  IS_DRY_RUN,
} from '../constants';
import { INDEX_SPECS } from './create_indices';

const alias = AGENT_SESSIONS_ALIAS;
const index = AGENT_SESSIONS_INDEX;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Compare declared mapping parameters, allowing OpenSearch's omitted defaults. */
export function mappingDifferences(
  expected: unknown,
  actual: unknown,
  path = 'mappings'
): string[] {
  if (expected !== null && typeof expected === 'object') {
    return Object.entries(expected).flatMap(([key, value]) => {
      const live = record(actual)[key];
      // OpenSearch may omit these default-true field parameters on reads.
      if (
        live === undefined &&
        value === true &&
        (key === 'index' || key === 'doc_values')
      ) {
        return [];
      }
      return mappingDifferences(value, live, `${path}.${key}`);
    });
  }
  return expected === actual ? [] : [path];
}

async function aliasState(search: Client) {
  if ((await search.indices.existsAlias({ name: alias })).body) {
    const response = await search.indices.getAlias({ name: alias });
    const targets = Object.keys(response.body);
    if (targets.length !== 1 || targets[0] !== index) {
      throw new Error(
        `Refusing unexpected ${alias} alias targets: ${targets.join(', ')}`
      );
    }
    return 'ready' as const;
  }
  return (await search.indices.exists({ index: alias })).body
    ? ('physical' as const)
    : ('missing' as const);
}

async function verifyMapping(search: Client, expected: unknown) {
  const response = await search.indices.getMapping({ index });
  const differences = mappingDifferences(
    expected,
    response.body[index]?.mappings
  );
  if (differences.length) {
    throw new Error(
      `Refusing incompatible ${index} mapping: ${differences.join(', ')}`
    );
  }
}

export async function migrateAgentSessions(search: Client, dryRun = true) {
  const spec = INDEX_SPECS.find((entry) => entry.aliasName === alias);
  if (!spec || spec.indexName !== index) {
    throw new Error('Missing canonical agent-session index specification');
  }
  const initialState = await aliasState(search);
  if ((await search.indices.existsAlias({ name: index })).body) {
    throw new Error(`Expected ${index} to be a physical index, found an alias`);
  }
  const exists = (await search.indices.exists({ index })).body;
  if (exists) await verifyMapping(search, spec.body.mappings);
  if (initialState === 'ready') {
    if (!exists) throw new Error(`Alias target ${index} is missing`);
    console.log(`${alias} already points to ${index} with the correct mapping`);
    return;
  }

  const actions = [
    ...(initialState === 'physical'
      ? [{ remove_index: { index: alias } }]
      : []),
    { add: { index, alias, is_write_index: true } },
  ];
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}${alias} -> ${index}`);
  if (!exists) console.log(`Create ${index} using the canonical mapping`);
  if (initialState === 'physical') {
    console.log(`Delete the physical ${alias} index and its old search data`);
  }
  console.log('No historical data will be copied or backfilled');
  console.log(JSON.stringify({ actions }, null, 2));
  if (dryRun) return;

  if (!exists) {
    const created = await search.indices.create({ index, body: spec.body });
    if (!created.body.acknowledged) {
      throw new Error(
        `Creation of ${index} was not acknowledged; rerun to inspect`
      );
    }
  }
  await verifyMapping(search, spec.body.mappings);
  const health = await search.cluster.health({
    index,
    wait_for_status: 'yellow',
    timeout: '30s',
  });
  if (health.body.timed_out || health.body.status === 'red') {
    throw new Error(
      `${index} has unavailable primary shards; leaving ${alias} intact`
    );
  }
  if ((await aliasState(search)) !== initialState) {
    throw new Error(`${alias} changed during migration; rerun to inspect`);
  }
  // One atomic operation prevents a writer from auto-creating the bare index
  // between its removal and alias creation. Never issue a separate DELETE.
  const swapped = await search.indices.updateAliases({ body: { actions } });
  if (!swapped.body.acknowledged) {
    throw new Error('Alias update was not acknowledged; rerun to inspect');
  }
  if ((await aliasState(search)) !== 'ready') {
    throw new Error('Agent-session alias verification failed');
  }
  await verifyMapping(search, spec.body.mappings);
  console.log(`${alias} is ready for new session events`);
}

if (import.meta.main) {
  try {
    await migrateAgentSessions(client(), IS_DRY_RUN);
  } catch (error) {
    // Client errors can contain connection credentials in request metadata.
    console.error(error instanceof Error ? error.message : 'Migration failed');
    process.exitCode = 1;
  }
}
