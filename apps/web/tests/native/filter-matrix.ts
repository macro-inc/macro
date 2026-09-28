// Loaded by Vite inside the real Tauri webview, never in the Node/Bun runner.

import { print } from 'graphql';
import {
  CHANNELS_QUERY_DEFINITIONS,
  channelsQueryArgs,
} from '../../src/features/channels-view/queries';
import { EMAIL_TABS } from '../../src/features/email-view/constants';
import {
  EMAIL_FACETS,
  EMAIL_FILTER_GROUPS,
} from '../../src/features/email-view/filters/email-facets';
import { buildEmailQuery } from '../../src/features/email-view/queries/email-query';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
} from '../../src/features/next-soup/filters/configs/document-type-query';
import {
  compileToAst,
  queryStateFrom,
} from '../../src/features/next-soup/filters/filter-store';
import { mergeQuery } from '../../src/features/next-soup/filters/filter-store/query-store';
import {
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '../../src/features/next-soup/sidebar/soup-filter-presets';
import { applyDocumentTabScope } from '../../src/features/next-soup/soup-view/document-tab-scope';
import { createTagFacetContext, testFacets } from '../../src/features/soup';
import { TASK_TABS } from '../../src/features/tasks-view/constants';
import {
  TASK_FACETS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../../src/features/tasks-view/filters/task-facets';
import { buildTaskQuery } from '../../src/features/tasks-view/queries/task-query';
import type {
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
} from '../../src/lib/graphql-cache/protocol';
import { makeGraphqlSoupInput } from '../../src/lib/queries/soup/graphql/ast';
import {
  isCachedMailView,
  materializeMailView,
} from '../../src/lib/queries/soup/graphql/mail-view';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '../../src/lib/queries/soup/transform-utils';
import {
  type MailItemFieldsFragment,
  MailItemFieldsFragmentDoc,
} from '../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupItem,
  getGraphqlSoupCacheHost,
  mapGraphqlSoupItem,
} from '../../src/lib/service-clients/service-storage/graphql-soup';
import {
  FILE_TYPES,
  type FixtureRow,
  filterCorpus,
  LINKS,
  matrixTagSets,
  PEOPLE,
  PRIORITY,
  STATUS,
  TAG_DEFINITION,
  TAGS,
} from './fixtures/filter-corpus';
import { USER_ID } from './fixtures/mail';

const corpus = filterCorpus();
const byKey = new Map(corpus.map((row) => [key(row), row]));
const tagContext = createTagFacetContext(matrixTagSets);
const ALL_INBOXES = '__all_inboxes__';
const ordered = (ids: string[]) => [...ids].sort();
function key(row: FixtureRow) {
  return `${row.api.__typename}:${row.id}`;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const intersects = (selected: string[], values: readonly string[]) =>
  selected.length === 0 || selected.some((value) => values.includes(value));

function subsets(values: readonly string[]): string[][] {
  return values.reduce<string[][]>(
    (sets, value) => [...sets, ...sets.map((set) => [...set, value])],
    [[]]
  );
}
function* combinations(
  groups: Record<string, string[][]>,
  entries = Object.entries(groups),
  index = 0,
  selection: Record<string, string[]> = {}
): Generator<Record<string, string[]>> {
  if (index === entries.length) {
    yield selection;
    return;
  }
  const [id, choices] = entries[index];
  for (const choice of choices)
    yield* combinations(groups, entries, index + 1, {
      ...selection,
      [id]: choice,
    });
}
const staticChoices = (group: 'read' | 'done') => [
  [],
  ...EMAIL_FILTER_GROUPS.find((g) => g.id === group)!
    .options.filter((o) => o.id !== 'all')
    .map((o) => [o.id]),
];

type View = 'email' | 'tasks' | 'files' | 'channels';
type Scope = View | 'files-shared-creators';
type Case = {
  view: View;
  name: string;
  args: EntityFilterCacheArgs;
  expected: FixtureRow[];
  attachments?: string[];
  emailTab?: string;
};
function args(
  input: ReturnType<typeof makeGraphqlSoupInput>
): EntityFilterCacheArgs {
  assert(
    input.initial,
    'Matrix only evaluates initial, ungrouped filter selections'
  );
  const { filters, emailView } = input.initial;
  if (emailView)
    assert(
      isCachedMailView(emailView),
      `Unsupported matrix Mail view ${emailView}`
    );
  return {
    filters: filters ?? {},
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit: 100,
    ...(emailView ? { mail: { view: emailView } } : { baseline: [] }),
  };
}
function translate(query: ReturnType<typeof buildEmailQuery>) {
  return args(
    makeGraphqlSoupInput({
      params: {
        ...query.params,
        sort_method: 'updated_at',
        sort_direction: 'desc',
      },
      body: query.body,
    })
  );
}
function emailMatch(
  row: FixtureRow,
  tab: string,
  selection: Record<string, string[]>
): boolean {
  if (row.kind !== 'email') return false;
  if (
    tab === 'shared'
      ? !row.shared || row.owner === USER_ID
      : !LINKS.includes(row.linkId!)
  )
    return false;
  if (tab === 'important' && (!row.signal || !row.inbox)) return false;
  if (tab === 'noise' && (row.signal || !row.inbox)) return false;
  if (tab === 'drafts' && !row.draft) return false;
  if (tab === 'sent' && !row.sent) return false;
  if (tab === 'calendar' && !row.calendar) return false;
  if (
    (selection.inboxes[0] !== ALL_INBOXES &&
      !selection.inboxes.includes(row.linkId!)) ||
    !intersects(selection.tags, row.tags)
  )
    return false;
  if (
    (selection.read[0] === 'read' && !row.read) ||
    (selection.read[0] === 'unread' && row.read)
  )
    return false;
  if (
    (selection.done[0] === 'done' && row.inbox) ||
    (selection.done[0] === 'not-done' && !row.inbox)
  )
    return false;
  return selection.calendar.length === 0 || row.calendar === true;
}

function* cases(scope?: Scope): Generator<Case> {
  const sharedCreators = scope === 'files-shared-creators';
  const view = sharedCreators ? 'files' : scope;
  // Coverage is exhaustive over the finite fixture domains, not pairwise.
  assert(
    TASK_STATUS_OPTIONS.map((o) => o.id).join() === STATUS.join(),
    'Update status fixture domains for new UI options'
  );
  assert(
    TASK_PRIORITY_OPTIONS.map((o) => o.id).join() === PRIORITY.join(),
    'Update priority fixture domains for new UI options'
  );
  assert(
    TASK_FACETS.map((facet) => facet.id).join() ===
      'status,priority,assignees,created-by,tags',
    'Add new task facets to the matrix'
  );
  assert(
    getActiveDocumentTypeFilterIds(() => true).join() === FILE_TYPES.join(),
    'Add new file types to the matrix fixtures'
  );
  assert(
    Object.keys(VIEW_TAB_PRESETS.documents.tabs).join() ===
      'owned,shared,attachments,folders,all',
    'Add new Files tabs to the matrix'
  );
  assert(
    Object.keys(CHANNELS_QUERY_DEFINITIONS)
      .filter((scope) => scope !== 'search')
      .join() === 'recents,channels,direct_messages',
    'Add new channel scopes to the matrix'
  );
  const attachmentOptions = EMAIL_FILTER_GROUPS.find(
    (g) => g.id === 'attachments'
  )!.options.map((o) => o.id);
  assert(
    attachmentOptions.join() ===
      'attachment-pdf,attachment-image,attachment-document',
    'Add new attachment types to matrix fixtures'
  );
  for (const tab of !view || view === 'email' ? EMAIL_TABS : []) {
    for (const selection of combinations({
      read: staticChoices('read'),
      done: staticChoices('done'),
      calendar: [[], ['has-calendar-invite']],
      tags: subsets(TAGS),
      inboxes: [[ALL_INBOXES], ...subsets(LINKS)],
      attachments: subsets(attachmentOptions),
    })) {
      const facets = {
        read: selection.read,
        done: selection.done,
        calendar: selection.calendar,
        tags: selection.tags,
        attachments: selection.attachments,
      };
      const query = buildEmailQuery({
        tab: tab.id,
        inboxIds:
          selection.inboxes[0] === ALL_INBOXES ? undefined : selection.inboxes,
        facets,
        facetContext: tagContext,
      });
      const expected: FixtureRow[] = [];
      for (const row of corpus) {
        if (emailMatch(row, tab.id, selection)) expected.push(row);
      }
      yield {
        view: 'email',
        name: `${tab.id} ${JSON.stringify(selection)}`,
        args: translate(query),
        expected,
        attachments: selection.attachments,
        emailTab: tab.id,
      };
    }
  }
  for (const tab of !view || view === 'tasks' ? TASK_TABS : []) {
    for (const selection of combinations({
      status: subsets(STATUS),
      priority: subsets(PRIORITY),
      assignees: subsets(PEOPLE),
      'created-by': subsets(PEOPLE),
      tags: subsets(TAGS),
    })) {
      const query = buildTaskQuery({
        tab: tab.id,
        userId: USER_ID,
        facets: selection,
        facetContext: tagContext,
        groupBy: 'none',
        sort: [{ id: 'updated_at', reversed: false }],
      });
      const expected: FixtureRow[] = [];
      for (const row of corpus) {
        if (
          row.kind === 'task' &&
          (tab.id !== 'my-tasks' || row.assignees!.includes(USER_ID)) &&
          (tab.id !== 'created-by-me' || row.owner === USER_ID) &&
          intersects(selection.status, [row.status!]) &&
          intersects(selection.priority, [row.priority!]) &&
          intersects(selection.assignees, row.assignees!) &&
          intersects(selection['created-by'], [row.owner]) &&
          intersects(selection.tags, row.tags)
        )
          expected.push(row);
      }
      yield {
        view: 'tasks',
        name: `${tab.id} ${JSON.stringify(selection)}`,
        args: translate(query),
        expected,
      };
    }
  }
  for (const tab of !view || view === 'files'
    ? sharedCreators
      ? ['shared', 'all']
      : ['owned', 'shared', 'attachments', 'folders', 'all']
    : []) {
    const preset = getViewPreset('documents', tab, {
      userId: USER_ID,
      isTeamAdmin: false,
    });
    assert(preset, `Missing Files preset ${tab}`);
    for (const selection of combinations({
      type: sharedCreators
        ? [[], ['file-pdf'], ['file-pdf', 'file-code']]
        : subsets(FILE_TYPES),
      'created-by': tab === 'owned' ? [[]] : subsets(PEOPLE),
      tags: subsets(TAGS),
    })) {
      let state = queryStateFrom(preset.filters);
      const types = buildDocumentTypeQuery(selection.type);
      if (types) state = mergeQuery(state, types);
      if (selection['created-by'].length)
        state = mergeQuery(state, {
          include: { documentOwnerId: selection['created-by'] },
        });
      state = mergeQuery(state, {
        include: {
          tagFilters: selection.tags.map((value) => ({
            propertyId: TAG_DEFINITION,
            type: 'select',
            value,
          })),
        },
      });
      const query = {
        params: { limit: 100 },
        body: compileToAst(applyDocumentTabScope(state, tab, USER_ID)),
      };
      const expected: FixtureRow[] = [];
      for (const row of corpus) {
        if (!intersects(selection.tags, row.tags)) continue;
        if (tab === 'folders') {
          if (row.kind === 'project') expected.push(row);
          continue;
        }
        if (row.kind !== 'file') continue;
        if (tab === 'owned' && (row.owner !== USER_ID || row.attachment))
          continue;
        if (tab === 'shared' && (row.owner === USER_ID || row.attachment))
          continue;
        if (tab === 'attachments' && !row.attachment) continue;
        if (
          intersects(selection['created-by'], [row.owner]) &&
          intersects(selection.type, [row.category!])
        )
          expected.push(row);
      }
      yield {
        view: 'files',
        name: `${tab} ${JSON.stringify(selection)}`,
        args: translate(query),
        expected,
      };
    }
  }
  for (const scope of !view || view === 'channels'
    ? (['recents', 'channels', 'direct_messages'] as const)
    : []) {
    assert(CHANNELS_QUERY_DEFINITIONS[scope], `Missing channel scope ${scope}`);
    yield {
      view: 'channels',
      name: scope,
      args: translate(channelsQueryArgs(scope)),
      expected: corpus.filter(
        (row) =>
          row.kind === 'channel' &&
          (scope === 'channels'
            ? !row.direct
            : scope === 'direct_messages'
              ? row.direct
              : true)
      ),
    };
  }
}

const host = (() => {
  const host = getGraphqlSoupCacheHost();
  assert(host, 'Real Tauri cache host must already be initialized');
  return host;
})();
let iterator: Generator<Case> | undefined;
const records = new Map<string, MailItemFieldsFragment>();
let revision: string | undefined;
const expectedSelectionCounts = {
  email: 20_160,
  tasks: 98_304,
  files: 69_632,
  channels: 3,
};
const progress = {
  scope: 'all' as Scope | 'all',
  evaluated: 0,
  nativeElapsedMs: 0,
  nativeRequests: 0,
  byView: {} as Record<string, number>,
  failures: [] as {
    name: string;
    error: string;
    args?: EntityFilterCacheArgs;
    fixture?: unknown;
  }[],
  done: false,
};

export function describeCases(size: number, view?: Scope) {
  const result = [];
  for (const test of cases(view)) {
    result.push({
      name: test.name,
      args: test.args,
      expected: test.expected.map(key),
    });
    if (result.length === size) break;
  }
  return result;
}

export async function runBatch(size = 128, view?: Scope) {
  if (iterator)
    assert(
      progress.scope === (view ?? 'all'),
      'Cannot change matrix scope mid-run'
    );
  progress.scope = view ?? 'all';
  iterator ??= cases(view);
  if (!revision) {
    revision = await host.currentRevision();
    const selected = await host.readRecordsByKeys({
      document: print(MailItemFieldsFragmentDoc),
      fragmentName: 'MailItemFields',
      keys: [...byKey.keys()],
    });
    assert(
      selected.records.length === corpus.length,
      'Every matrix entity must have been backfilled through the real API'
    );
    for (const row of selected.records)
      records.set(row.recordKey, row.record as MailItemFieldsFragment);
  }
  const batch: Case[] = [];
  for (let n = 0; n < size && !progress.done; n++) {
    const next = iterator.next();
    if (next.done) {
      progress.done = true;
      break;
    }
    batch.push(next.value);
  }
  const requests = [
    ...new Map(
      batch.map((test) => [JSON.stringify(test.args), test.args])
    ).entries(),
  ];
  const responses = new Map<string, EntityFilterCacheResult | Error>();
  // Amortize WebKit IPC round trips. The native engine still serializes every
  // evaluation through its real mutex, and no mutations run during this phase.
  const nativeStart = performance.now();
  for (let offset = 0; offset < requests.length; offset += 8) {
    await Promise.all(
      requests.slice(offset, offset + 8).map(async ([key, args]) => {
        try {
          responses.set(key, await host.entityFilter(args));
        } catch (error) {
          responses.set(
            key,
            error instanceof Error ? error : new Error(String(error))
          );
        }
        progress.nativeRequests++;
      })
    );
  }
  progress.nativeElapsedMs += performance.now() - nativeStart;
  for (const test of batch) {
    progress.evaluated++;
    progress.byView[test.view] = (progress.byView[test.view] ?? 0) + 1;
    try {
      const result = responses.get(JSON.stringify(test.args));
      if (result instanceof Error) throw result;
      assert(result, 'Missing native evaluation response');
      assert(
        result.kind === 'mail-page' || result.kind === 'reconciled',
        `Local evaluation returned ${result.kind}`
      );
      assert(result.revision === revision, 'Matrix crossed cache revisions');
      assert(
        JSON.stringify(ordered(result.keys)) ===
          JSON.stringify(ordered(test.expected.map(key))),
        `Wrong native matches: ${JSON.stringify(result.keys)}; expected ${JSON.stringify(test.expected.map(key))}`
      );
      if (result.kind === 'reconciled')
        assert(
          result.retainedKeys.length === 0,
          'Matrix must not use server membership baselines'
        );
      if (test.attachments && result.kind === 'mail-page') {
        const view = test.args.mail!.view;
        const actual = result.keys.filter((key, i) => {
          const record = records.get(key);
          assert(record, `No normalized record for ${key}`);
          const projected = materializeMailView(
            record,
            view,
            result.sortTimestamps[i]
          );
          assert(projected, 'Canonical Mail preview is missing');
          const item = mapGraphqlSoupItem(projected as GraphqlSoupItem);
          assert(
            item && isDisplayableSoupItem(item),
            'Cannot materialize Mail row'
          );
          const entity = mapApiSoupItemToEntity(item);
          assert(entity.type === 'email', 'Expected email entity');
          return testFacets(
            { attachments: test.attachments ?? [] },
            EMAIL_FACETS,
            entity,
            tagContext
          );
        });
        const expected = test.expected
          .filter(
            (row) =>
              !test.attachments!.length ||
              test.attachments!.includes(`attachment-${row.attachmentKind}`)
          )
          .map(key);
        assert(
          JSON.stringify(ordered(actual)) === JSON.stringify(ordered(expected)),
          'Cached attachment refinement differs from fixture truth'
        );
      }
    } catch (error) {
      if (progress.failures.length < 20)
        progress.failures.push({
          name: `${test.view}: ${test.name}`,
          error: String(error),
          args: test.args,
          fixture:
            test.view === 'email'
              ? {
                  links: LINKS,
                  rows: corpus
                    .filter((row) => row.kind === 'email')
                    .map((row) => ({
                      id: row.id,
                      link: row.linkId,
                      sent: row.sent,
                      owner: row.owner,
                      tags: row.tags,
                    })),
                }
              : undefined,
        });
    }
  }
  try {
    assert(
      (await host.currentRevision()) === revision,
      'Cache changed during the filter-only matrix'
    );
  } catch (error) {
    // Preserve the earlier failing inputs even if an outstanding native command
    // also prevents the final revision read from completing.
    if (progress.failures.length < 20)
      progress.failures.push({
        name: 'post-batch cache revision',
        error: String(error),
      });
  }
  if (progress.done) {
    const counts =
      view === 'files-shared-creators'
        ? { files: 96 }
        : expectedSelectionCounts;
    for (const [surface, count] of Object.entries(counts)) {
      if (!view || view === 'files-shared-creators' || view === surface)
        assert(
          progress.byView[surface] === count,
          `Selection coverage changed for ${surface}: ${progress.byView[surface]} != ${count}`
        );
    }
  }
  return progress;
}
