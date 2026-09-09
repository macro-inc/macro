/** Structured, read-only tool results. Unknown payloads remain fully inspectable. */
import CaretRight from '@phosphor/caret-right.svg';
import FileText from '@phosphor/file-text.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { FoldedOutput } from './FoldedOutput';

export function resultRecord(
  value: unknown
): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function fieldLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

const TITLE_FIELDS = [
  'title',
  'name',
  'label',
  'subject',
  'emailSubject',
  'email_subject',
  'documentName',
  'channelName',
  'emailAddress',
  'email',
  'displayName',
  'content',
  'text',
  'description',
];
const META_FIELDS = [
  'description',
  'emailAddress',
  'email',
  'username',
  'handle',
  'status',
  'type',
  'scope',
  'startsAt',
  'start',
  'nextRunAt',
  'dueAt',
];

function textField(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
}

/** Notifications carry their human-readable title inside metadata. */
function recordTitle(
  record: Record<string, unknown>,
  depth = 0
): string | undefined {
  const title = textField(record, TITLE_FIELDS);
  if (title) return title;
  if (depth < 2) {
    for (const key of [
      'metadata',
      'payload',
      'notification',
      'entity',
      'content',
    ]) {
      const nested = resultRecord(record[key]);
      if (nested) {
        const text = recordTitle(nested, depth + 1);
        if (text) return text;
      }
    }
  }
  return typeof record.eventType === 'string'
    ? fieldLabel(record.eventType)
    : undefined;
}

function recordStatus(record: Record<string, unknown>): string | undefined {
  if (record.isPrimary === true) return 'Primary inbox';
  if (record.isDelegated === true) return 'Delegated inbox';
  if (record.done === true) return 'Done';
  if (record.seen === false) return 'Unread';
  if (record.overdue === true) return 'Overdue';
}

/** Short factual summary for the collapsed tool row; never invent a success. */
export function resultSummary(value: unknown): string | undefined {
  if (Array.isArray(value)) return `${value.length} results`;
  const record = resultRecord(value);
  if (!record) return undefined;
  if (Array.isArray(record.tagSets)) {
    const sets = record.tagSets.map(resultRecord);
    const count = sets.reduce(
      (sum, set) => sum + (Array.isArray(set?.tags) ? set.tags.length : 0),
      0
    );
    return `${count} tags`;
  }
  const lists = Object.entries(record).filter(([, val]) => Array.isArray(val));
  if (lists.length === 1) {
    const [key, list] = lists[0];
    const count = (list as unknown[]).length;
    const label = fieldLabel(key);
    const singular =
      label === 'companies'
        ? 'company'
        : label === 'entities'
          ? 'entity'
          : label === 'inboxes'
            ? 'inbox'
            : label.endsWith('s')
              ? label.slice(0, -1)
              : label;
    return `${count} ${count === 1 ? singular : label}`;
  }
  return textField(record, ['summary', 'title', 'name', 'subject']);
}

function ResultFields(props: { value: Record<string, unknown> }) {
  return (
    <dl class="grid min-w-0 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-5 gap-y-2 text-xs leading-5">
      <For each={Object.entries(props.value)}>
        {([key, value]) => (
          <>
            <dt class="max-w-40 break-words text-ink-extra-muted first-letter:uppercase">
              {fieldLabel(key)}
            </dt>
            <dd class="min-w-0 text-ink-muted">
              <Show
                when={value !== null && value !== undefined}
                fallback={<span class="text-ink-extra-muted">Not set</span>}
              >
                <Show
                  when={typeof value === 'object'}
                  fallback={
                    <span class="whitespace-pre-wrap wrap-break-word">
                      {String(value)}
                    </span>
                  }
                >
                  <Show
                    when={typeof resultRecord(value)?.text === 'string'}
                    fallback={
                      <details class="group/field">
                        <summary class="flex list-none items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                          <CaretRight class="size-3 group-open/field:rotate-90" />
                          {Array.isArray(value)
                            ? `${value.length} items`
                            : 'Details'}
                        </summary>
                        <div class="mt-2">
                          <FoldedOutput text={JSON.stringify(value, null, 2)} />
                        </div>
                      </details>
                    }
                  >
                    <p class="max-h-64 overflow-auto text-sm leading-6 whitespace-pre-wrap wrap-break-word">
                      {String(resultRecord(value)?.text)}
                    </p>
                  </Show>
                </Show>
              </Show>
            </dd>
          </>
        )}
      </For>
    </dl>
  );
}

/** Bounded lists keep hundreds of results from taking over the transcript. */
export function ResultList(props: {
  items: unknown[];
  icon?: JSX.Element;
  renderLink?: (item: unknown) => JSX.Element;
}) {
  const [limit, setLimit] = createSignal(20);
  return (
    <div class="max-h-80 overflow-y-auto overscroll-contain">
      <Show
        when={props.items.length > 0}
        fallback={
          <p class="px-4 py-5 text-sm text-ink-extra-muted">No results</p>
        }
      >
        <For each={props.items.slice(0, limit())}>
          {(item, index) => {
            const record = () => resultRecord(item);
            const title = () =>
              record()
                ? (recordTitle(record()!) ?? `Result ${index() + 1}`)
                : String(item);
            const meta = () =>
              record()
                ? (recordStatus(record()!) ??
                  textField(
                    record()!,
                    META_FIELDS.filter((key) => record()![key] !== title())
                  ))
                : undefined;
            return (
              <details class="group/result border-b border-edge-muted last:border-b-0">
                <summary class="flex min-h-14 list-none items-center gap-3 px-4 py-2.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge-muted bg-ink/3 text-ink-muted">
                    {props.icon ?? <FileText class="size-4" />}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span
                      class="block truncate text-[13px] font-medium text-ink"
                      title={title()}
                    >
                      {title()}
                    </span>
                    <Show when={meta()}>
                      <span class="block truncate text-xs text-ink-extra-muted">
                        {meta()}
                      </span>
                    </Show>
                  </span>
                  <CaretRight class="size-3.5 shrink-0 text-ink-extra-muted group-open/result:rotate-90" />
                </summary>
                <div class="border-t border-edge-muted bg-ink/2 px-4 py-3">
                  <Show when={props.renderLink?.(item)}>
                    {(link) => <div class="mb-3">{link()}</div>}
                  </Show>
                  <Show
                    when={record()}
                    fallback={
                      <p class="text-sm whitespace-pre-wrap wrap-break-word">
                        {String(item)}
                      </p>
                    }
                  >
                    {(value) => <ResultFields value={value()} />}
                  </Show>
                </div>
              </details>
            );
          }}
        </For>
        <Show when={props.items.length > limit()}>
          <button
            type="button"
            class="min-h-10 w-full border-t border-edge-muted text-xs text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
            onClick={() => setLimit((value) => value + 50)}
          >
            Show more · {props.items.length - limit()} remaining
          </button>
        </Show>
      </Show>
    </div>
  );
}

export function ToolResult(props: {
  value: unknown;
  icon?: JSX.Element;
  renderLink?: (item: unknown) => JSX.Element;
}) {
  const record = () => resultRecord(props.value);
  const collections = () =>
    Object.entries(record() ?? {}).filter(([, value]) => Array.isArray(value));
  const fields = () =>
    Object.fromEntries(
      Object.entries(record() ?? {}).filter(
        ([key, value]) => !Array.isArray(value) && key !== 'summary'
      )
    );
  return (
    <Show
      when={!Array.isArray(props.value)}
      fallback={
        <ResultList
          items={props.value as unknown[]}
          icon={props.icon}
          renderLink={props.renderLink}
        />
      }
    >
      <Show
        when={record()}
        fallback={
          <div class="px-4 py-3 text-sm leading-6 whitespace-pre-wrap wrap-break-word">
            {String(props.value ?? 'No output returned')}
          </div>
        }
      >
        <Show when={typeof record()?.summary === 'string'}>
          <p class="border-b border-edge-muted px-4 py-3 text-xs leading-5 text-ink-muted">
            {String(record()?.summary)}
          </p>
        </Show>
        <For each={collections()}>
          {([key, value]) => (
            <section>
              <Show when={collections().length > 1}>
                <h4 class="bg-ink/3 px-4 py-2 text-xs text-ink-muted first-letter:uppercase">
                  {fieldLabel(key)} · {(value as unknown[]).length}
                </h4>
              </Show>
              <ResultList
                items={value as unknown[]}
                icon={props.icon}
                renderLink={props.renderLink}
              />
            </section>
          )}
        </For>
        <Show when={Object.keys(fields()).length > 0}>
          <div class="px-4 py-3">
            <ResultFields value={fields()} />
          </div>
        </Show>
        <Show when={Object.keys(record() ?? {}).length === 0}>
          <p class="px-4 py-4 text-sm text-ink-extra-muted">No output fields</p>
        </Show>
      </Show>
    </Show>
  );
}
