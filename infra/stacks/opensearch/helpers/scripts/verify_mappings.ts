/**
 * Pre/post-flight check: compare every live index mapping against the body
 * declared for it in create_indices.ts. Exits non-zero when an index is
 * missing fields the code expects, or when a field's type disagrees.
 *
 * Every index body is `dynamic: 'false'`, so a field that exists in code but
 * not on the cluster fails silently: the service writes it, OpenSearch drops
 * it, and searches over it match nothing. Run this after deploying code that
 * indexes a new field, and after `create_indices.ts` to confirm convergence.
 *
 * Usage:
 *   bun scripts/verify_mappings.ts
 *   INDEX=call_records bun scripts/verify_mappings.ts   # one index only
 */
import type { Client } from '@opensearch-project/opensearch';
import {
  INDEX_SPECS,
  type MappingConvergencePlan,
  planMappingConvergence,
  selectIndexSpecs,
} from './create_indices';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mappingProperties = (
  mappings: unknown
): Record<string, unknown> | undefined => {
  if (!isRecord(mappings)) return undefined;
  return isRecord(mappings.properties) ? mappings.properties : undefined;
};

async function livePropertiesFor(
  opensearchClient: Client,
  indexName: string
): Promise<Record<string, unknown> | undefined> {
  const response = await opensearchClient.indices.getMapping({
    index: indexName,
  });
  return mappingProperties((response.body ?? {})[indexName]?.mappings);
}

function describe(indexName: string, plan: MappingConvergencePlan): boolean {
  const drifted = plan.missingPaths.length > 0 || plan.conflictPaths.length > 0;
  const status = drifted ? 'FAIL' : 'OK';
  console.log(`${indexName.padEnd(20)} [${status}]`);
  if (plan.missingPaths.length > 0) {
    console.log(`    missing: ${plan.missingPaths.join(', ')}`);
    console.log(
      `    fix: DRY_RUN=false bun scripts/create_indices.ts, then backfill the entity`
    );
  }
  for (const path of plan.conflictPaths) {
    console.log(
      `    type conflict: "${path}" — needs reindex_with_alias_swap.ts`
    );
  }
  return !drifted;
}

async function main() {
  await import('dotenv').then((m) => m.config());
  const { client } = await import('../client');

  const opensearchClient = client();
  const filter = process.env.INDEX;
  const specs = selectIndexSpecs(INDEX_SPECS, filter);
  if (specs.length === 0) {
    console.error(
      `INDEX="${filter}" matches no index. Known: ` +
        `${INDEX_SPECS.map((s) => s.aliasName).join(', ')}.`
    );
    process.exit(1);
  }

  let allOk = true;
  console.log('index                [status]');
  console.log('-'.repeat(70));

  for (const { indexName, body } of specs) {
    const exists = (await opensearchClient.indices.exists({ index: indexName }))
      .body;
    if (!exists) {
      console.log(`${indexName.padEnd(20)} [FAIL]`);
      console.log(
        `    missing index — run DRY_RUN=false bun scripts/create_indices.ts`
      );
      allOk = false;
      continue;
    }

    const plan = planMappingConvergence({
      desired: mappingProperties(body.mappings),
      live: await livePropertiesFor(opensearchClient, indexName),
    });
    if (!describe(indexName, plan)) {
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\nMapping verification failed.');
    process.exit(1);
  }
  console.log('\nEvery index mapping matches create_indices.ts.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Error', err);
    process.exit(1);
  });
}
