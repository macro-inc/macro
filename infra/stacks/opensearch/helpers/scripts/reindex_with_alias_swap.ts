/**
 * Reindex an index behind an alias to a new versioned index, then atomically
 * swap the alias.
 *
 * Usage:
 *   bun scripts/reindex_with_alias_swap.ts <alias> <new_index> [<old_index>]
 *
 * Examples:
 *   # Roll documents to v2; resolve old physical index from current alias
 *   bun scripts/reindex_with_alias_swap.ts documents documents_v2
 *
 *   # Promote a physical index that was created without an alias to live
 *   # behind one (no reindex needed in that case — pass the same name twice)
 *   bun scripts/reindex_with_alias_swap.ts call_records call_records old_call_records
 *
 * Reindex strategy: async submission with `slices=auto` (parallelises across
 * primary shards) plus task-API polling. This keeps a 60+ minute documents
 * reindex from being killed by the ALB / proxy idle timeout that a
 * `wait_for_completion=true` request would hit.
 *
 * The script defaults to DRY-RUN. Set DRY_RUN=false to apply changes.
 *
 * Optional env:
 *   REINDEX_SLICES        — slice count, defaults to "auto" (= shard count).
 *   REINDEX_POLL_SECONDS  — poll interval in seconds, default 10.
 *
 * Required env: OPENSEARCH_URL, OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD.
 */
import type { Client } from '@opensearch-project/opensearch';

export type SwapState = {
  alias: string;
  newIndex: string;
  oldIndex?: string;
  aliasExists: boolean;
  aliasNameIsPhysicalIndex: boolean;
};

/**
 * Build the atomic `_aliases` actions list for the swap. Pure function so it
 * can be unit-tested without an OpenSearch connection.
 *
 * Cases:
 * - Alias already exists pointing at oldIndex → remove from oldIndex, add to newIndex.
 * - Alias name is currently a physical index (no alias yet) → remove_index +
 *   add alias atomically (OpenSearch allows this in a single _aliases call).
 * - Neither exists → just add. (First-time alias setup.)
 */
export function buildSwapActions(
  state: SwapState
): Array<Record<string, unknown>> {
  const { alias, newIndex, oldIndex, aliasExists, aliasNameIsPhysicalIndex } =
    state;
  const actions: Array<Record<string, unknown>> = [];
  if (aliasNameIsPhysicalIndex && oldIndex === alias) {
    actions.push({ remove_index: { index: alias } });
  } else if (aliasExists && oldIndex && oldIndex !== newIndex) {
    actions.push({ remove: { index: oldIndex, alias } });
  }
  actions.push({ add: { index: newIndex, alias } });
  return actions;
}

async function resolveCurrentIndex(
  opensearchClient: Client,
  alias: string
): Promise<string | undefined> {
  try {
    const response = await opensearchClient.indices.getAlias({ name: alias });
    const indices = Object.keys(response.body ?? {});
    if (indices.length > 1) {
      console.warn(
        `Alias "${alias}" points at multiple indices: ${indices.join(', ')}. ` +
          `Pass <old_index> explicitly to disambiguate.`
      );
      return undefined;
    }
    return indices[0];
  } catch (_err) {
    return undefined;
  }
}

async function refreshIndex(opensearchClient: Client, index: string) {
  await opensearchClient.indices.refresh({ index });
}

async function countDocs(
  opensearchClient: Client,
  index: string
): Promise<number> {
  const res = await opensearchClient.count({ index });
  return Number(res.body?.count ?? 0);
}

export type TaskStatus = {
  total?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  batches?: number;
  version_conflicts?: number;
  noops?: number;
  failures?: unknown[];
  running_time_in_nanos?: number;
};

/**
 * Format a single progress line from a reindex task status. Pure function
 * so the formatting is unit-testable.
 */
export function formatTaskProgress(status: TaskStatus): string {
  const total = status.total ?? 0;
  const done = (status.created ?? 0) + (status.updated ?? 0);
  const pct = total > 0 ? `${((done / total) * 100).toFixed(1)}%` : '?';
  const elapsedSec = Math.floor((status.running_time_in_nanos ?? 0) / 1e9);
  const conflicts = status.version_conflicts ?? 0;
  const conflictsLabel = conflicts > 0 ? ` conflicts=${conflicts}` : '';
  return `[${elapsedSec}s] ${done}/${total} (${pct})${conflictsLabel}`;
}

async function startReindexAsync(
  opensearchClient: Client,
  source: string,
  dest: string,
  slices: string | number
): Promise<string> {
  const resp = await opensearchClient.reindex({
    wait_for_completion: false,
    refresh: true,
    slices,
    body: {
      source: { index: source },
      dest: { index: dest },
    },
  });
  const taskId = (resp.body as { task?: string }).task;
  if (!taskId) {
    throw new Error(
      `reindex submission did not return a task id: ${JSON.stringify(resp.body)}`
    );
  }
  return taskId;
}

async function getTask(
  opensearchClient: Client,
  taskId: string
): Promise<{
  completed: boolean;
  task?: { status?: TaskStatus };
  response?: unknown;
  error?: unknown;
}> {
  // The opensearch-js client supports tasks.get(); fall back to raw transport
  // if the API surface differs.
  const resp = await opensearchClient.tasks.get({ task_id: taskId });
  return resp.body as {
    completed: boolean;
    task?: { status?: TaskStatus };
    response?: unknown;
    error?: unknown;
  };
}

async function cancelTask(opensearchClient: Client, taskId: string) {
  try {
    await opensearchClient.tasks.cancel({ task_id: taskId });
    console.log(`Sent cancel for task ${taskId}.`);
  } catch (err) {
    console.warn('Cancel request failed:', err);
  }
}

async function waitForTask(
  opensearchClient: Client,
  taskId: string,
  pollMs: number
): Promise<{ status: TaskStatus; failures: unknown[] }> {
  // Allow Ctrl+C to cancel the running reindex rather than orphaning it.
  let cancelled = false;
  const onSigint = () => {
    if (cancelled) return;
    cancelled = true;
    console.log('\nReceived SIGINT — cancelling reindex task...');
    void cancelTask(opensearchClient, taskId);
  };
  process.on('SIGINT', onSigint);

  try {
    while (true) {
      const t = await getTask(opensearchClient, taskId);
      const status = t.task?.status ?? {};
      console.log(`reindex progress: ${formatTaskProgress(status)}`);
      if (t.completed) {
        const failures =
          (t.response as { failures?: unknown[] } | undefined)?.failures ?? [];
        if (t.error) {
          throw new Error(`reindex task failed: ${JSON.stringify(t.error)}`);
        }
        return { status, failures };
      }
      if (cancelled) {
        throw new Error('reindex cancelled by operator');
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}

async function reindexAndSwap(
  opensearchClient: Client,
  args: {
    alias: string;
    newIndex: string;
    oldIndex?: string;
    slices: string | number;
    pollMs: number;
  },
  dryRun: boolean
) {
  const aliasArg = args.alias;
  const newIndexArg = args.newIndex;
  const oldIndexArg = args.oldIndex;
  const slices = args.slices;
  const pollMs = args.pollMs;

  console.log('\n' + '='.repeat(60));
  console.log(
    `Reindex + alias swap ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));

  const alias = aliasArg;
  const newIndex = newIndexArg;

  const aliasExists = (
    await opensearchClient.indices.existsAlias({ name: alias })
  ).body;
  const aliasAsIndexExists = (
    await opensearchClient.indices.exists({ index: alias })
  ).body;

  let oldIndex: string | undefined = oldIndexArg;
  if (!oldIndex) {
    if (aliasExists) {
      oldIndex = await resolveCurrentIndex(opensearchClient, alias);
    } else if (aliasAsIndexExists) {
      // The alias name currently resolves to a physical index — we'll need to
      // delete that physical index in the same atomic actions block as the
      // alias add, since OpenSearch cannot have an alias and an index share
      // a name.
      oldIndex = alias;
    }
  }

  console.log(
    `alias=${alias} new_index=${newIndex} old_index=${oldIndex ?? '<none>'}`
  );

  const newIndexExists = (
    await opensearchClient.indices.exists({ index: newIndex })
  ).body;
  if (!newIndexExists) {
    console.error(
      `New index "${newIndex}" does not exist. Create it first (with the desired mapping) before running this script.`
    );
    process.exit(1);
  }

  if (oldIndex && oldIndex !== newIndex) {
    if (dryRun) {
      console.log(
        `[DRY-RUN] Would reindex from ${oldIndex} -> ${newIndex} (slices=${slices}, async + task polling every ${pollMs}ms)`
      );
    } else {
      console.log(
        `Reindexing ${oldIndex} -> ${newIndex} async (slices=${slices})...`
      );
      const taskId = await startReindexAsync(
        opensearchClient,
        oldIndex,
        newIndex,
        slices
      );
      console.log(`Submitted reindex task: ${taskId}`);
      const { status, failures } = await waitForTask(
        opensearchClient,
        taskId,
        pollMs
      );
      if (failures.length > 0) {
        console.error(
          `Refusing to swap: reindex task reported ${failures.length} failures.`
        );
        console.error(JSON.stringify(failures.slice(0, 5), null, 2));
        process.exit(2);
      }
      console.log(
        `Reindex complete: ${status.created ?? 0} created, ${status.updated ?? 0} updated, ${status.version_conflicts ?? 0} conflicts.`
      );
    }
  } else {
    console.log('Skipping reindex (no separate source index).');
  }

  if (!dryRun && oldIndex && oldIndex !== newIndex) {
    await refreshIndex(opensearchClient, newIndex);
    const oldCount = await countDocs(opensearchClient, oldIndex);
    const newCount = await countDocs(opensearchClient, newIndex);
    console.log(`doc count: old=${oldCount} new=${newCount}`);
    if (newCount < oldCount) {
      console.error(
        `Refusing to swap: destination has fewer docs (${newCount} < ${oldCount}).`
      );
      process.exit(2);
    }
  }

  const actions = buildSwapActions({
    alias,
    newIndex,
    oldIndex,
    aliasExists,
    aliasNameIsPhysicalIndex: aliasAsIndexExists,
  });

  if (dryRun) {
    console.log('[DRY-RUN] Would run _aliases with actions:');
    console.log(JSON.stringify({ actions }, null, 2));
    console.log('\nTo apply, set DRY_RUN=false');
    return;
  }

  console.log('Applying alias swap...');
  const swapResp = await opensearchClient.indices.updateAliases({
    body: { actions },
  });
  console.log('swap response:', JSON.stringify(swapResp.body));

  console.log('\nNext steps:');
  console.log(
    `  - Verify writes through alias "${alias}" land in "${newIndex}"`
  );
  console.log(
    `  - Once confident, delete the old index: bun scripts/delete_indices.ts "${oldIndex ?? '<old>'}"`
  );
}

async function main() {
  // Dynamic imports — keep the module side-effect-free so the unit test can
  // import `buildSwapActions` without firing OpenSearch network calls.
  await import('dotenv').then((m) => m.config());
  const { client } = await import('../client');
  const { IS_DRY_RUN } = await import('../constants');

  const [aliasArg, newIndexArg, oldIndexArg] = process.argv.slice(2);
  if (!aliasArg || !newIndexArg) {
    console.error(
      'Usage: bun scripts/reindex_with_alias_swap.ts <alias> <new_index> [<old_index>]'
    );
    process.exit(1);
  }

  const slicesEnv = process.env.REINDEX_SLICES ?? 'auto';
  const slices = slicesEnv === 'auto' ? 'auto' : Number.parseInt(slicesEnv, 10);
  if (slices !== 'auto' && Number.isNaN(slices)) {
    console.error(
      `REINDEX_SLICES must be "auto" or a positive integer, got "${slicesEnv}"`
    );
    process.exit(1);
  }
  const pollSeconds = Number.parseInt(
    process.env.REINDEX_POLL_SECONDS ?? '10',
    10
  );
  if (Number.isNaN(pollSeconds) || pollSeconds < 1) {
    console.error(
      `REINDEX_POLL_SECONDS must be a positive integer, got "${process.env.REINDEX_POLL_SECONDS}"`
    );
    process.exit(1);
  }

  await reindexAndSwap(
    client(),
    {
      alias: aliasArg,
      newIndex: newIndexArg,
      oldIndex: oldIndexArg,
      slices,
      pollMs: pollSeconds * 1000,
    },
    IS_DRY_RUN
  );
}

// Bun executes top-level statements only when the file is run directly, but we
// still gate to be explicit and safe under different test runners.
if (import.meta.main) {
  main().catch((err) => {
    console.error('Error', err);
    process.exit(1);
  });
}
