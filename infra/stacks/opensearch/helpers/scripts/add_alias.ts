/**
 * Idempotent additive alias creation: adds an alias name on top of an
 * existing physical index without disrupting any other alias already
 * pointing at it.
 *
 * Errors if the alias name is currently a physical index — use
 * reindex_with_alias_swap.ts for that case.
 *
 * Usage:
 *   bun scripts/add_alias.ts <alias> <index>
 *
 * The script defaults to DRY-RUN. Set DRY_RUN=false to apply.
 */
import type { Client } from '@opensearch-project/opensearch';

export type AddAliasState = {
  alias: string;
  targetIndex: string;
  aliasAlreadyOnTarget: boolean;
  aliasIsPhysicalIndex: boolean;
};

export type AddAliasOutcome =
  | { kind: 'noop'; reason: string }
  | { kind: 'apply'; action: Record<string, unknown> }
  | { kind: 'error'; reason: string };

/**
 * Pure-function decision: given the observed state, what should we do?
 *
 * - Alias already exists on the target index → no-op.
 * - Alias name is currently a physical index (not an alias) → error; this
 *   tool is for additive aliases only. Use reindex_with_alias_swap.ts to
 *   convert a physical index into an alias.
 * - Otherwise → add the alias.
 */
export function decideAddAlias(state: AddAliasState): AddAliasOutcome {
  const { alias, targetIndex, aliasAlreadyOnTarget, aliasIsPhysicalIndex } =
    state;

  if (aliasIsPhysicalIndex) {
    return {
      kind: 'error',
      reason: `"${alias}" is a physical index, not an alias. Use reindex_with_alias_swap.ts to convert it.`,
    };
  }

  if (aliasAlreadyOnTarget) {
    return {
      kind: 'noop',
      reason: `alias "${alias}" already points at "${targetIndex}"`,
    };
  }

  return {
    kind: 'apply',
    action: { add: { index: targetIndex, alias } },
  };
}

async function main() {
  await import('dotenv').then((m) => m.config());
  const { client } = await import('../client');
  const { IS_DRY_RUN } = await import('../constants');

  const [aliasArg, targetIndexArg] = process.argv.slice(2);
  if (!aliasArg || !targetIndexArg) {
    console.error('Usage: bun scripts/add_alias.ts <alias> <index>');
    process.exit(1);
  }

  const opensearchClient: Client = client();

  const targetIndexExists = (
    await opensearchClient.indices.exists({ index: targetIndexArg })
  ).body;
  if (!targetIndexExists) {
    console.error(`Target index "${targetIndexArg}" does not exist.`);
    process.exit(1);
  }

  const aliasIsPhysicalIndex = await (async () => {
    const a = await opensearchClient.indices.existsAlias({ name: aliasArg });
    if (a.body) return false;
    const i = await opensearchClient.indices.exists({ index: aliasArg });
    return i.body;
  })();

  const aliasAlreadyOnTarget = (
    await opensearchClient.indices.existsAlias({
      name: aliasArg,
      index: targetIndexArg,
    })
  ).body;

  const outcome = decideAddAlias({
    alias: aliasArg,
    targetIndex: targetIndexArg,
    aliasAlreadyOnTarget,
    aliasIsPhysicalIndex,
  });

  console.log(
    `Add-alias ${IS_DRY_RUN ? '(DRY-RUN MODE)' : '(LIVE MODE)'}: alias=${aliasArg} target=${targetIndexArg}`
  );

  if (outcome.kind === 'error') {
    console.error(outcome.reason);
    process.exit(1);
  }

  if (outcome.kind === 'noop') {
    console.log(`No-op: ${outcome.reason}`);
    return;
  }

  const actions = [outcome.action];
  if (IS_DRY_RUN) {
    console.log('[DRY-RUN] Would run _aliases with actions:');
    console.log(JSON.stringify({ actions }, null, 2));
    console.log('\nTo apply, set DRY_RUN=false');
    return;
  }

  console.log('Applying alias add...');
  const resp = await opensearchClient.indices.updateAliases({
    body: { actions },
  });
  console.log('response:', JSON.stringify(resp.body));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Error', err);
    process.exit(1);
  });
}
