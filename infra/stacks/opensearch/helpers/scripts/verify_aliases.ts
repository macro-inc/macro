/**
 * Pre/post-flight check: print a table of current alias state and compare
 * against the expected mapping defined in constants.ts. Exits non-zero if
 * any expected alias is missing, points at the wrong physical index, or
 * resolves to multiple physical indices (which would make swap ambiguous).
 *
 * Run this before deploying code that depends on the new alias names, and
 * again after a migration to confirm the end state.
 *
 * Usage:
 *   bun scripts/verify_aliases.ts
 */
import { type Client, errors } from '@opensearch-project/opensearch';
import {
  type CreateIndexArgs,
  INDEX_SPECS,
  selectIndexSpecs,
} from './create_indices';

export type AliasState = {
  alias: string;
  expectedIndex: string;
  actualIndices: string[];
  aliasNameIsPhysicalIndex: boolean;
  isWriteIndex?: boolean;
};

export type VerifyOutcome = {
  ok: boolean;
  reason?: string;
};

export function evaluateAlias(state: AliasState): VerifyOutcome {
  const { alias, expectedIndex, actualIndices, aliasNameIsPhysicalIndex } =
    state;

  if (aliasNameIsPhysicalIndex && actualIndices.length === 0) {
    return {
      ok: false,
      reason: `"${alias}" is a physical index — needs reindex+swap to become an alias for "${expectedIndex}"`,
    };
  }

  if (actualIndices.length === 0) {
    return {
      ok: false,
      reason: `alias "${alias}" does not exist`,
    };
  }

  if (actualIndices.length > 1) {
    return {
      ok: false,
      reason: `alias "${alias}" points at multiple indices: ${actualIndices.join(', ')}`,
    };
  }

  if (actualIndices[0] !== expectedIndex) {
    return {
      ok: false,
      reason: `alias "${alias}" points at "${actualIndices[0]}", expected "${expectedIndex}"`,
    };
  }

  if (state.isWriteIndex === false) {
    return { ok: false, reason: `alias "${alias}" is not writable` };
  }

  return { ok: true };
}

async function getAlias(opensearchClient: Client, alias: string) {
  try {
    const response = await opensearchClient.indices.getAlias({ name: alias });
    return response.body;
  } catch (error) {
    if (error instanceof errors.ResponseError && error.statusCode === 404) {
      return {};
    }
    throw error;
  }
}

async function isPhysicalIndex(
  opensearchClient: Client,
  name: string
): Promise<boolean> {
  // exists returns true for both indices and aliases; combined with the
  // empty-indices check from getActualIndices we can tell them apart.
  const aliasResp = await opensearchClient.indices.existsAlias({ name });
  if (aliasResp.body) return false;
  const indexResp = await opensearchClient.indices.exists({ index: name });
  return indexResp.body;
}

export async function verifyAliases(
  opensearchClient: Client,
  specs: CreateIndexArgs[]
) {
  let allOk = true;
  console.log('alias               -> expected_index            (actual)');
  console.log('-'.repeat(70));

  for (const { aliasName: alias, indexName: expectedIndex } of specs) {
    const aliases = await getAlias(opensearchClient, alias);
    const actualIndices = Object.keys(aliases);
    const aliasNameIsPhysicalIndex =
      actualIndices.length === 0
        ? await isPhysicalIndex(opensearchClient, alias)
        : false;

    const outcome = evaluateAlias({
      alias,
      expectedIndex,
      actualIndices,
      aliasNameIsPhysicalIndex,
      isWriteIndex: aliases[expectedIndex]?.aliases?.[alias]?.is_write_index,
    });

    const actualLabel = aliasNameIsPhysicalIndex
      ? `<physical index "${alias}">`
      : actualIndices.length === 0
        ? '<missing>'
        : actualIndices.join(', ');

    const status = outcome.ok ? 'OK' : 'FAIL';
    console.log(
      `${alias.padEnd(20)} -> ${expectedIndex.padEnd(24)} (${actualLabel})   [${status}]`
    );
    if (!outcome.ok) {
      console.log(`    reason: ${outcome.reason}`);
      allOk = false;
    }
  }

  if (!allOk) {
    throw new Error('Alias verification failed');
  }
  console.log('\nAll aliases match expected state.');
}

if (import.meta.main) {
  try {
    const { client } = await import('../client');
    const specs = selectIndexSpecs(INDEX_SPECS, process.env.INDEX);
    if (specs.length === 0)
      throw new Error(`Unknown INDEX: ${process.env.INDEX}`);
    await verifyAliases(client(), specs);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Alias verification failed'
    );
    process.exitCode = 1;
  }
}
