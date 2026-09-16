/** Verify canonical mappings, including join relations and field parameters.
 * Usage: INDEX=agent_sessions bun scripts/verify_mappings.ts
 */
import type { Client } from '@opensearch-project/opensearch';
import { verifyIndexMapping } from '../utils/mappings';
import {
  type CreateIndexArgs,
  INDEX_SPECS,
  selectIndexSpecs,
} from './create_indices';

export async function verifyMappings(search: Client, specs: CreateIndexArgs[]) {
  for (const { indexName, body } of specs) {
    await verifyIndexMapping(search, indexName, body.mappings);
    console.log(`${indexName}: mapping verified`);
  }
}

if (import.meta.main) {
  try {
    const { client } = await import('../client');
    const specs = selectIndexSpecs(INDEX_SPECS, process.env.INDEX);
    if (specs.length === 0)
      throw new Error(`Unknown INDEX: ${process.env.INDEX}`);
    await verifyMappings(client(), specs);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Mapping verification failed'
    );
    process.exitCode = 1;
  }
}
