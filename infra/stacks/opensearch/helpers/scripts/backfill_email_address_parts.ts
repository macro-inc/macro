require('dotenv').config();

import { client } from '../client';
import { EMAIL_INDEX, IS_DRY_RUN } from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';

// Mirrors opensearch_client upsert/email.rs address_search_fields: lowercased
// domains with their dot-suffixes (at least two labels) and local parts with
// their dot/plus segments, deduped and sorted.
const PAINLESS_SOURCE = `
List addrs = new ArrayList();
if (ctx._source.sender != null) { addrs.add(ctx._source.sender); }
if (ctx._source.reply_to != null) { addrs.add(ctx._source.reply_to); }
String[] listFields = new String[] {"recipients", "cc", "bcc"};
for (int fi = 0; fi < listFields.length; fi++) {
  def v = ctx._source[listFields[fi]];
  if (v != null) { addrs.addAll(v); }
}
Set domains = new TreeSet();
Set locals = new TreeSet();
for (int ai = 0; ai < addrs.size(); ai++) {
  String a = addrs[ai].trim().toLowerCase();
  int at = a.lastIndexOf("@");
  if (at < 1 || at >= a.length() - 1) { continue; }
  String local = a.substring(0, at);
  String domain = a.substring(at + 1);
  locals.add(local);
  String[] segs = local.replace("+", ".").splitOnToken(".");
  for (int si = 0; si < segs.length; si++) {
    if (segs[si].length() > 0) { locals.add(segs[si]); }
  }
  String[] rawLabels = domain.splitOnToken(".");
  List labels = new ArrayList();
  for (int li = 0; li < rawLabels.length; li++) {
    if (rawLabels[li].length() > 0) { labels.add(rawLabels[li]); }
  }
  if (labels.size() <= 1) {
    domains.addAll(labels);
  } else {
    for (int start = 0; start < labels.size() - 1; start++) {
      StringBuilder sb = new StringBuilder();
      for (int lj = start; lj < labels.size(); lj++) {
        if (lj > start) { sb.append("."); }
        sb.append(labels[lj]);
      }
      domains.add(sb.toString());
    }
  }
}
ctx._source.domains = new ArrayList(domains);
ctx._source.local_parts = new ArrayList(locals);
`;

async function backfillEmailAddressParts(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Backfill domains/local_parts on emails index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nOnly documents missing the domains field are touched, so this is'
  );
  console.log('idempotent and safe to re-run until it reports 0 updates.');

  const indexExists = await checkIndexExists(opensearchClient, EMAIL_INDEX);
  if (!indexExists) {
    console.log(`⚠️  Index "${EMAIL_INDEX}" does not exist. Aborting.`);
    return;
  }

  const query = {
    bool: {
      must_not: [{ exists: { field: 'domains' } }],
    },
  };

  const countResponse = await opensearchClient.count({
    index: EMAIL_INDEX,
    body: { query },
  });
  const docCount = countResponse.body.count;
  console.log(`\n${docCount} documents are missing domains/local_parts.`);

  if (dryRun) {
    console.log(`[DRY-RUN] Would update ${docCount} documents.`);
    console.log('\nTo run for real, set DRY_RUN=false environment variable\n');
    return;
  }

  if (docCount === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  const response = await opensearchClient.updateByQuery({
    index: EMAIL_INDEX,
    wait_for_completion: false,
    scroll_size: 5000,
    slices: 'auto',
    refresh: false,
    conflicts: 'proceed',
    body: {
      query,
      script: { lang: 'painless', source: PAINLESS_SOURCE },
    },
  });

  const taskId = response.body.task;
  console.log(`Started async task: ${taskId}`);
  console.log('Polling for completion...');

  let completed = false;
  let taskResponse: any;
  while (!completed) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    taskResponse = await opensearchClient.tasks.get({ task_id: taskId });
    completed = taskResponse.body.completed;
    if (!completed) {
      const status = taskResponse.body.task?.status;
      if (status) {
        console.log(
          `Progress: ${status.updated ?? 0}/${status.total ?? 0} documents processed`
        );
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
        `⚠️  ${versionConflicts} version conflicts (expected during active writes, caught on next run)`
      );
    }
    if (otherFailures > 0) {
      console.error(
        '⚠️  Non-version-conflict failures:',
        taskResult.failures.filter(
          (f: any) => f.cause?.type !== 'version_conflict_engine_exception'
        )
      );
      throw new Error('Update by query failed for some documents');
    }
  }

  console.log(
    `\n✓ Updated ${taskResult.updated ?? 0} of ${taskResult.total ?? 0} documents.`
  );
  console.log(
    '💡 Re-run after deploys to catch documents added mid-backfill.\n'
  );
}

backfillEmailAddressParts(IS_DRY_RUN);
