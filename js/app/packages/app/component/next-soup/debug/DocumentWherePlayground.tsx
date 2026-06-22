import {
  compileToAst,
  type DocumentFieldFilters,
  type DocumentFilterExpression,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { throwOnErr } from '@core/util/result';
import { ListEntity, ListLayoutProvider } from '@entity';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import { storageServiceClient } from '@service-storage/client';
import type {
  PostSoupRequest,
  SoupApiItem,
  SoupPage,
} from '@service-storage/generated/schemas';
import { Button, InlineCheckbox, SegmentedControl } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

type FilterTokenId =
  | 'pdf'
  | 'docx'
  | 'canvas'
  | 'image-assoc'
  | 'code-assoc'
  | 'md'
  | 'snippet'
  | 'task'
  | 'plain-md'
  | 'email-attachment'
  | 'not-email-attachment'
  | 'unseen'
  | 'seen'
  | 'not-done'
  | 'done'
  | 'updated-this-year';
type ExpressionMode = 'or' | 'and' | 'nested-md' | 'not-selected';
type EndpointMode = 'ast' | 'simple';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const FILTER_TOKENS: {
  id: FilterTokenId;
  label: string;
  detail: string;
  expression: DocumentFilterExpression;
}[] = [
  {
    id: 'pdf',
    label: 'PDF',
    detail: 'fileType = pdf',
    expression: { include: { fileType: ['pdf'] } },
  },
  {
    id: 'docx',
    label: 'DOCX',
    detail: 'fileType = docx',
    expression: { include: { fileType: ['docx'] } },
  },
  {
    id: 'canvas',
    label: 'Canvas',
    detail: 'fileType = canvas',
    expression: { include: { fileType: ['canvas'] } },
  },
  {
    id: 'image-assoc',
    label: 'Images',
    detail: 'fileAssoc = assoc:image',
    expression: { include: { fileAssoc: ['assoc:image'] } },
  },
  {
    id: 'code-assoc',
    label: 'Code',
    detail: 'fileAssoc = assoc:code',
    expression: { include: { fileAssoc: ['assoc:code'] } },
  },
  {
    id: 'md',
    label: 'Any markdown',
    detail: 'fileType = md',
    expression: { include: { fileType: ['md'] } },
  },
  {
    id: 'snippet',
    label: 'Snippet',
    detail: 'fileType = md AND subType = snippet',
    expression: {
      op: 'and',
      clauses: [
        { include: { fileType: ['md'] } },
        { include: { subType: ['snippet'] } },
      ],
    },
  },
  {
    id: 'task',
    label: 'Task',
    detail: 'fileType = md AND subType = task',
    expression: {
      op: 'and',
      clauses: [
        { include: { fileType: ['md'] } },
        { include: { subType: ['task'] } },
      ],
    },
  },
  {
    id: 'plain-md',
    label: 'Plain markdown',
    detail: 'fileType = md AND NOT subType in snippet/task',
    expression: {
      op: 'and',
      clauses: [
        { include: { fileType: ['md'] } },
        { exclude: { subType: ['snippet', 'task'] } },
      ],
    },
  },
  {
    id: 'email-attachment',
    label: 'Email attachments',
    detail: 'isEmailAttachment = true',
    expression: { include: { isEmailAttachment: true } },
  },
  {
    id: 'not-email-attachment',
    label: 'Not email attachments',
    detail: 'isEmailAttachment = false',
    expression: { include: { isEmailAttachment: false } },
  },
  {
    id: 'unseen',
    label: 'Unseen',
    detail: 'documentSeen = false',
    expression: { include: { documentSeen: false } },
  },
  {
    id: 'seen',
    label: 'Seen',
    detail: 'documentSeen = true',
    expression: { include: { documentSeen: true } },
  },
  {
    id: 'not-done',
    label: 'Not done',
    detail: 'documentDone = false',
    expression: { include: { documentDone: false } },
  },
  {
    id: 'done',
    label: 'Done',
    detail: 'documentDone = true',
    expression: { include: { documentDone: true } },
  },
  {
    id: 'updated-this-year',
    label: 'Updated this year',
    detail: 'documentUpdatedAt >= Jan 1 of the current year',
    expression: {
      include: {
        documentUpdatedAt: {
          gte: `${new Date().getFullYear()}-01-01T00:00:00.000Z`,
        },
      },
    },
  },
];

const EXAMPLES: {
  label: string;
  mode: ExpressionMode;
  tokens: FilterTokenId[];
}[] = [
  {
    label: 'PDF OR markdown snippets/tasks',
    mode: 'nested-md',
    tokens: ['pdf', 'snippet', 'task'],
  },
  {
    label: 'Documents: md/canvas but not tasks',
    mode: 'and',
    tokens: ['md', 'plain-md'],
  },
  {
    label: 'Unread PDF attachments',
    mode: 'and',
    tokens: ['pdf', 'email-attachment', 'unseen'],
  },
  {
    label: 'Everything except selected types',
    mode: 'not-selected',
    tokens: ['task', 'snippet'],
  },
];

const SIMPLE_SOUP_NON_DOCUMENT_FILTERS: Pick<
  PostSoupRequest,
  | 'call_filters'
  | 'channel_filters'
  | 'channel_thread_filters'
  | 'chat_filters'
  | 'crm_company_filters'
  | 'email_filters'
  | 'foreign_entity_filters'
  | 'project_filters'
> = {
  call_filters: { call_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  crm_company_filters: { company_ids: [NIL_UUID] },
  email_filters: { email_thread_ids: [NIL_UUID] },
  foreign_entity_filters: { ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
};

const AST_SOUP_DOCUMENT_ONLY_FILTERS: Query['include'] = {
  callId: [NIL_UUID],
  channelId: [NIL_UUID],
  channelThreadId: [NIL_UUID],
  chatId: [NIL_UUID],
  crmCompanyId: [NIL_UUID],
  foreignEntityRecordId: [NIL_UUID],
  folderId: [NIL_UUID],
  threadId: [NIL_UUID],
};

function tokenExpression(id: FilterTokenId): DocumentFilterExpression {
  return FILTER_TOKENS.find((token) => token.id === id)?.expression ?? {};
}

function expressionFromTokens(
  selected: Set<FilterTokenId>,
  mode: ExpressionMode,
  customClause: DocumentFilterExpression | undefined
): DocumentFilterExpression {
  const clauses = [...selected].map(tokenExpression);
  if (customClause) clauses.push(customClause);

  if (clauses.length === 0) return { include: { documentId: [NIL_UUID] } };
  if (clauses.length === 1 && mode !== 'not-selected') return clauses[0];

  if (mode === 'and') return { op: 'and', clauses };
  if (mode === 'not-selected')
    return { op: 'not', clause: { op: 'or', clauses } };
  if (mode === 'nested-md') {
    const markdownClauses = [...selected]
      .filter((id) => ['md', 'snippet', 'task', 'plain-md'].includes(id))
      .map(tokenExpression);
    const nonMarkdownClauses = [...selected]
      .filter((id) => !['md', 'snippet', 'task', 'plain-md'].includes(id))
      .map(tokenExpression);
    const groupedClauses = [
      ...nonMarkdownClauses,
      ...(markdownClauses.length
        ? [{ op: 'or', clauses: markdownClauses } as DocumentFilterExpression]
        : []),
      ...(customClause ? [customClause] : []),
    ];

    if (groupedClauses.length === 1) return groupedClauses[0];
    return { op: 'or', clauses: groupedClauses };
  }

  return { op: 'or', clauses };
}

function simpleRequestFromClauses(
  selected: Set<FilterTokenId>,
  limit: number
): PostSoupRequest {
  const fileTypes = new Set<string>();
  const subTypes = new Set<string>();

  if (selected.has('pdf')) fileTypes.add('pdf');
  if (selected.has('docx')) fileTypes.add('docx');
  if (selected.has('canvas')) fileTypes.add('canvas');

  if (
    selected.has('md') ||
    selected.has('snippet') ||
    selected.has('task') ||
    selected.has('plain-md')
  ) {
    fileTypes.add('md');
  }

  if (selected.has('snippet')) subTypes.add('snippet');
  if (selected.has('task')) subTypes.add('task');

  return {
    ...SIMPLE_SOUP_NON_DOCUMENT_FILTERS,
    document_filters: {
      document_ids: selected.size === 0 ? [NIL_UUID] : undefined,
      file_types: fileTypes.size ? [...fileTypes] : undefined,
      sub_types: subTypes.size ? [...subTypes] : undefined,
    },
    limit,
    sort_method: 'viewed_updated',
  };
}

export default function DocumentWherePlayground() {
  const [resultsRef, setResultsRef] = createSignal<HTMLElement>();
  const [mode, setMode] = createSignal<EndpointMode>('ast');
  const [expressionMode, setExpressionMode] =
    createSignal<ExpressionMode>('nested-md');
  const [selected, setSelected] = createSignal<Set<FilterTokenId>>(
    new Set(['pdf', 'snippet', 'task'])
  );
  const [limit, setLimit] = createSignal(20);
  const [jsonText, setJsonText] = createSignal('');
  const [useJson, setUseJson] = createSignal(false);
  const [documentIds, setDocumentIds] = createSignal('');
  const [ownerIds, setOwnerIds] = createSignal('');
  const [projectIds, setProjectIds] = createSignal('');
  const [updatedAfter, setUpdatedAfter] = createSignal('');
  const [updatedBefore, setUpdatedBefore] = createSignal('');
  const [items, setItems] = createSignal<SoupApiItem[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  const splitValues = (value: string) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

  const customClause = createMemo<DocumentFilterExpression | undefined>(() => {
    const include: DocumentFieldFilters = {};
    const documentIdValues = splitValues(documentIds());
    const ownerValues = splitValues(ownerIds());
    const projectValues = splitValues(projectIds());
    const updatedAfterValue = updatedAfter().trim();
    const updatedBeforeValue = updatedBefore().trim();

    if (documentIdValues.length) include.documentId = documentIdValues;
    if (ownerValues.length) include.documentOwnerId = ownerValues;
    if (projectValues.length) include.projectId = projectValues;
    if (updatedAfterValue || updatedBeforeValue) {
      include.documentUpdatedAt = {
        ...(updatedAfterValue && { gte: updatedAfterValue }),
        ...(updatedBeforeValue && { lte: updatedBeforeValue }),
      };
    }

    return Object.keys(include).length ? { include } : undefined;
  });

  const selectedExpression = createMemo(() =>
    expressionFromTokens(selected(), expressionMode(), customClause())
  );

  const parsedExpression = createMemo<DocumentFilterExpression | undefined>(
    () => {
      if (!useJson()) return selectedExpression();
      try {
        return JSON.parse(jsonText()) as DocumentFilterExpression;
      } catch {
        return undefined;
      }
    }
  );

  const query = createMemo<Query>(() => ({
    include: AST_SOUP_DOCUMENT_ONLY_FILTERS,
    documentWhere: parsedExpression(),
  }));

  const compiled = createMemo(() => compileToAst(queryStateFrom(query())));
  const requestBody = createMemo(() => ({
    ...compiled(),
    limit: limit(),
    sort_method: 'viewed_updated' as const,
  }));
  const simpleRequestBody = createMemo(() =>
    simpleRequestFromClauses(selected(), limit())
  );
  const activeRequestBody = createMemo(() =>
    mode() === 'ast' ? requestBody() : simpleRequestBody()
  );
  const entities = createMemo(() =>
    items()
      .filter(isDisplayableSoupItem)
      .map((item) => mapApiSoupItemToEntity(item))
  );

  const run = async (cursor: string | null = null) => {
    setLoading(true);
    setError(undefined);

    try {
      if (!parsedExpression()) {
        throw new Error('Expression JSON is not valid');
      }

      const page = await throwOnErr(async () => {
        if (mode() === 'simple') {
          return await storageServiceClient.getSoupItems({
            params: { cursor },
            body: simpleRequestBody(),
          });
        }

        return await storageServiceClient.getSoupAstItems({
          params: { cursor },
          body: requestBody(),
        });
      });

      const soupPage = page as SoupPage;
      setItems((prev) =>
        cursor ? [...prev, ...soupPage.items] : soupPage.items
      );
      setNextCursor(soupPage.next_cursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleToken = (id: FilterTokenId) => {
    setUseJson(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const loadJsonFromControls = () => {
    setJsonText(JSON.stringify(selectedExpression(), null, 2));
    setUseJson(true);
  };

  const applyExample = (example: (typeof EXAMPLES)[number]) => {
    setUseJson(false);
    setExpressionMode(example.mode);
    setSelected(new Set(example.tokens));
  };

  return (
    <div class="flex h-full flex-col bg-bg text-ink">
      <header class="flex h-10 shrink-0 items-center border-edge-muted border-b px-4">
        <div class="text-sm font-medium">Document AST Playground</div>
      </header>
      <div class="grid min-h-0 flex-1 grid-cols-[420px_1fr] overflow-hidden">
        <aside class="flex min-h-0 flex-col gap-4 border-edge-muted border-r p-4">
          <section class="space-y-2">
            <div class="text-sm font-medium">Endpoint</div>
            <SegmentedControl
              class="w-full"
              size="sm"
              value={mode()}
              options={[
                { value: 'ast', label: 'AST soup' },
                { value: 'simple', label: 'Simple soup' },
              ]}
              onChange={(value) => setMode(value)}
            />
          </section>

          <section class="space-y-3">
            <div class="text-sm font-medium">Expression shape</div>
            <select
              class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              value={expressionMode()}
              onChange={(event) =>
                setExpressionMode(event.currentTarget.value as ExpressionMode)
              }
            >
              <option value="or">OR selected clauses</option>
              <option value="and">AND selected clauses</option>
              <option value="nested-md">
                OR selected, grouping markdown subtypes
              </option>
              <option value="not-selected">NOT selected clauses</option>
            </select>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Examples</div>
            <div class="grid grid-cols-1 gap-1">
              <For each={EXAMPLES}>
                {(example) => (
                  <Button
                    variant="base"
                    size="sm"
                    class="h-auto justify-start py-1.5"
                    onClick={() => applyExample(example)}
                  >
                    {example.label}
                  </Button>
                )}
              </For>
            </div>
          </section>

          <section class="min-h-0 space-y-3 overflow-auto">
            <div class="text-sm font-medium">Document clauses</div>
            <div class="grid grid-cols-2 gap-2">
              <For each={FILTER_TOKENS}>
                {(token) => (
                  <button
                    type="button"
                    class="flex min-h-14 items-start gap-2 rounded-sm border border-edge-muted bg-surface p-2 text-left text-sm hover:bg-hover"
                    classList={{
                      'border-accent/50 bg-accent-bg/30': selected().has(
                        token.id
                      ),
                    }}
                    onClick={() => toggleToken(token.id)}
                  >
                    <InlineCheckbox checked={selected().has(token.id)} />
                    <span class="min-w-0">
                      <span class="block">{token.label}</span>
                      <span class="block text-ink-secondary text-xs">
                        {token.detail}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Custom include fields</div>
            <input
              class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              placeholder="document ids, comma separated"
              value={documentIds()}
              onInput={(event) => setDocumentIds(event.currentTarget.value)}
            />
            <input
              class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              placeholder="owner ids, comma separated"
              value={ownerIds()}
              onInput={(event) => setOwnerIds(event.currentTarget.value)}
            />
            <input
              class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              placeholder="project ids, comma separated"
              value={projectIds()}
              onInput={(event) => setProjectIds(event.currentTarget.value)}
            />
            <div class="grid grid-cols-2 gap-2">
              <input
                class="rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
                placeholder="updated >= ISO"
                value={updatedAfter()}
                onInput={(event) => setUpdatedAfter(event.currentTarget.value)}
              />
              <input
                class="rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
                placeholder="updated <= ISO"
                value={updatedBefore()}
                onInput={(event) => setUpdatedBefore(event.currentTarget.value)}
              />
            </div>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Limit</div>
            <input
              class="w-24 rounded-sm border border-edge-muted bg-surface p-1 text-sm outline-none focus:border-accent"
              type="number"
              min="1"
              max="100"
              value={limit()}
              onInput={(event) =>
                setLimit(Number(event.currentTarget.value) || 20)
              }
            />
          </section>

          <section class="flex gap-2">
            <Button variant="base" size="sm" onClick={loadJsonFromControls}>
              Edit JSON
            </Button>
            <Button
              variant="cta"
              size="sm"
              disabled={loading()}
              onClick={() => run()}
            >
              Run
            </Button>
          </section>

          <Show when={useJson()}>
            <section class="min-h-0 flex-1 space-y-2">
              <div class="text-sm font-medium">documentWhere JSON</div>
              <textarea
                class="h-full min-h-48 w-full resize-none rounded-sm border border-edge-muted bg-surface p-2 font-mono text-xs outline-none focus:border-accent"
                value={jsonText()}
                onInput={(event) => setJsonText(event.currentTarget.value)}
              />
            </section>
          </Show>
        </aside>

        <main class="grid min-h-0 grid-cols-2 overflow-hidden">
          <section class="min-h-0 overflow-auto border-edge-muted border-r p-4">
            <div class="mb-2 text-sm font-medium">documentWhere expression</div>
            <pre class="mb-4 whitespace-pre-wrap rounded-sm border border-edge-muted bg-surface p-3 font-mono text-xs">
              {JSON.stringify(parsedExpression(), null, 2)}
            </pre>
            <div class="mb-2 text-sm font-medium">
              {mode() === 'ast'
                ? 'Compiled AST request body'
                : 'Simple soup request body'}
            </div>
            <pre class="whitespace-pre-wrap rounded-sm border border-edge-muted bg-surface p-3 font-mono text-xs">
              {JSON.stringify(activeRequestBody(), null, 2)}
            </pre>
            <Show when={mode() === 'simple' && selected().has('plain-md')}>
              <div class="mt-3 rounded-sm border border-edge-muted bg-surface p-2 text-ink-secondary text-sm">
                Simple soup cannot express the plain-markdown exclusion for
                snippet/task. It requests markdown documents and shows the old
                flat-filter behavior.
              </div>
            </Show>
            <Show when={error()}>
              <div class="mt-3 rounded-sm border border-failure/50 bg-failure/10 p-2 text-failure text-sm">
                {error()}
              </div>
            </Show>
          </section>

          <section ref={setResultsRef} class="min-h-0 overflow-auto p-4">
            <div class="mb-3 flex items-center justify-between">
              <div class="text-sm font-medium">
                Soup entities ({entities().length})
              </div>
              <Show when={nextCursor()}>
                <Button
                  variant="base"
                  size="sm"
                  disabled={loading()}
                  onClick={() => run(nextCursor())}
                >
                  Load more
                </Button>
              </Show>
            </div>

            <Show when={loading()}>
              <div class="mb-3 text-ink-secondary text-sm">Loading...</div>
            </Show>

            <Show when={items().length !== entities().length}>
              <div class="mb-3 rounded-sm border border-edge-muted bg-surface p-2 text-ink-secondary text-sm">
                {items().length - entities().length} returned soup items were
                not displayable entity rows.
              </div>
            </Show>

            <ListLayoutProvider ref={resultsRef}>
              <div class="space-y-1">
                <For each={entities()}>
                  {(entity) => (
                    <ListEntity
                      entity={entity}
                      hideCheckbox
                      onClick={() => console.log('Soup entity:', entity)}
                    />
                  )}
                </For>
              </div>
            </ListLayoutProvider>
          </section>
        </main>
      </div>
    </div>
  );
}
