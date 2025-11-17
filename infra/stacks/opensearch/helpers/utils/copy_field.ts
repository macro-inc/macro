import type { Client } from '@opensearch-project/opensearch';

/**
 * This function copies data from one field to another in an index.
 * @param opensearchClient An instance of the OpenSearch client.
 * @param indexName The name of the index to copy the data from.
 * @param oldField The name of the field to copy data from.
 * @param newField The name of the field to copy data to.
 * @param dryRun A boolean indicating whether to perform a dry run.
 * @returns A Promise that resolves when the data has been copied.
 */
export async function copyFieldData(
  opensearchClient: Client,
  indexName: string,
  oldField: string,
  newField: string,
  dryRun: boolean
): Promise<number> {
  const script = {
    source: `if (ctx._source.containsKey('${oldField}') && ctx._source.${oldField} != null) { ctx._source.${newField} = ctx._source.${oldField}; }`,
    lang: 'painless',
  };

  console.log(
    `  ${dryRun ? '[DRY-RUN] Would copy' : 'Copying'} data from "${oldField}" to "${newField}" in index "${indexName}"`
  );

  if (dryRun) {
    const countResponse = await opensearchClient.count({
      index: indexName,
      body: {
        query: {
          bool: {
            must: [{ exists: { field: oldField } }],
            must_not: [{ exists: { field: newField } }],
          },
        },
      },
    });
    const docCount = countResponse.body.count;
    console.log(
      `  [DRY-RUN] Would update ${docCount} documents where ${newField} does not exist`
    );
    return docCount;
  }

  const response = await opensearchClient.updateByQuery({
    index: indexName,
    wait_for_completion: false,
    scroll_size: 5000, // Larger batches for better performance
    slices: 'auto', // Enable parallel processing
    refresh: false, // Don't refresh after each batch
    body: {
      script,
      query: {
        bool: {
          must: [{ exists: { field: oldField } }],
          must_not: [{ exists: { field: newField } }],
        },
      },
    },
  });

  const body = response.body;

  if ('task' in body) {
    const taskId = body.task!;
    console.log(`Started async task: ${taskId}`);
    console.log(`Polling for completion...`);

    // Poll for task completion
    let completed = false;
    let taskResponse: any;

    while (!completed) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

      taskResponse = await opensearchClient.tasks.get({
        task_id: taskId,
      });

      completed = taskResponse.body.completed;

      if (!completed) {
        const status = taskResponse.body.task?.status;
        if (status) {
          const updated = status.updated ?? 0;
          const total = status.total ?? 0;
          console.log(`Progress: ${updated}/${total} documents processed`);
        }
      }
    }

    const taskResult = taskResponse.body.response;
    if (taskResult.failures && taskResult.failures.length > 0) {
      const versionConflicts = taskResult.failures.filter(
        (f: any) => f.cause?.type === 'version_conflict_engine_exception'
      ).length;
      const otherFailures = taskResult.failures.length - versionConflicts;

      if (versionConflicts > 0) {
        console.log(
          `  ⚠️  ${versionConflicts} version conflicts (expected during active writes, will be caught on next run)`
        );
      }

      if (otherFailures > 0) {
        console.error(
          `  ⚠️  Encountered ${otherFailures} non-version-conflict failures:`,
          taskResult.failures.filter(
            (f: any) => f.cause?.type !== 'version_conflict_engine_exception'
          )
        );
        throw new Error(`Update by query failed for some documents`);
      }
    }

    const updated = taskResult.updated ?? 0;
    const total = taskResult.total ?? 0;
    console.log(`  ✓ Updated ${updated} of ${total} documents`);
    return updated;
  }

  if ('took' in body) {
    if (body.failures && body.failures.length > 0) {
      const versionConflicts = body.failures.filter(
        (f: any) => f.cause?.type === 'version_conflict_engine_exception'
      ).length;
      const otherFailures = body.failures.length - versionConflicts;

      if (versionConflicts > 0) {
        console.log(
          `  ⚠️  ${versionConflicts} version conflicts (expected during active writes, will be caught on next run)`
        );
      }

      if (otherFailures > 0) {
        console.error(
          `  ⚠️  Encountered ${otherFailures} non-version-conflict failures:`,
          body.failures.filter(
            (f: any) => f.cause?.type !== 'version_conflict_engine_exception'
          )
        );
        throw new Error(`Update by query failed for some documents`);
      }
    }

    const updated = body.updated ?? 0;
    const total = body.total ?? 0;
    console.log(`  ✓ Updated ${updated} of ${total} documents`);
    return updated;
  }

  console.log(`  ⚠️  Unexpected response format`);
  return 0;
}

/**
 * This function verifies that data has been copied from one field to another in an index.
 * @param opensearchClient An instance of the OpenSearch client.
 * @param indexName The name of the index to verify the data in.
 * @param oldField The name of the field to copy data from.
 * @param newField The name of the field to copy data to.
 * @param dryRun A boolean indicating whether to perform a dry run.
 * @returns A Promise that resolves when the data has been verified.
 */
export async function verifyFieldCopy(
  opensearchClient: Client,
  indexName: string,
  oldField: string,
  newField: string,
  dryRun: boolean
): Promise<void> {
  console.log(
    `  ${dryRun ? '[DRY-RUN] Would verify' : 'Verifying'} migration for "${oldField}" → "${newField}" in index "${indexName}"`
  );

  if (dryRun) {
    console.log(
      `[DRY-RUN] Would fetch sample documents and compare date formats`
    );
    return;
  }

  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 150,
      query: {
        bool: {
          must: [
            { exists: { field: oldField } },
            { exists: { field: newField } },
          ],
        },
      },
      fields: [
        {
          field: oldField,
        },
        {
          field: newField,
        },
      ],
      _source: true,
    },
  });

  const hits = response.body.hits.hits;

  if (hits.length === 0) {
    console.log(
      `⚠️ No documents found with both "${oldField}" and "${newField}"`
    );
    return;
  }

  console.log(`📊 Sample verification (showing ${hits.length} documents):`);

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const oldDateRaw = hit._source?.[oldField];
    const newDateRaw = hit._source?.[newField];

    console.log(`\n    Document ${i + 1} (ID: ${hit._id}):`);
    console.log(`${oldField} (raw): ${oldDateRaw}`);
    console.log(`${newField} (raw): ${newDateRaw}`);

    if (oldDateRaw === newDateRaw) {
      console.log(`✓ Values match (${oldDateRaw})`);
    } else {
      console.log(`⚠️ Values don't match! ${oldDateRaw} vs ${newDateRaw}`);
    }
  }
}
