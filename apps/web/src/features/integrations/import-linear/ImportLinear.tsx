import { toast } from '@core/component/Toast/Toast';
import type { IUser } from '@core/user/types';
import { createTaskForAccount } from '@core/util/create';
import { parseCsv } from '@core/util/csv';
import { fireAndForget } from '@core/util/fireAndForget';
import { linearCsvRecordToMacroTaskDraft } from '@core/util/linearImport';
import { buildSimpleEntityUrl } from '@core/util/url';
import { Telemetry } from '@macro-inc/observability';
import {
  isCurrentQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { useQueryClient } from '@queries/client';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { soupKeys } from '@queries/soup/keys';
import { Button } from '@ui';
import {
  batch,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { ImportAssigneePicker } from './assignee-picker';
import { useImportAssignees } from './queries/assignees';

type ImportProgress =
  | { type: 'idle' }
  | { type: 'running'; done: number; total: number }
  | { type: 'done'; created: number; skipped: number; failed: number };

function normalize(s: string): string {
  return s.trim();
}

export default function ImportLinear() {
  const account = useQueryAccount();
  return (
    <Show when={account()} keyed>
      {(owner) => <ImportFile account={owner} />}
    </Show>
  );
}

function ImportFile(props: { account: QueryAccount }) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const current = () => !disposed && isCurrentQueryAccount(props.account);
  const upsertToHistory = useUpsertToHistoryMutation();
  const queryClient = useQueryClient();

  let fileInput: HTMLInputElement | undefined;
  const [fileName, setFileName] = createSignal<string>('');
  const [parseError, setParseError] = createSignal<string>('');
  const [records, setRecords] = createSignal<readonly Record<string, string>[]>(
    []
  );
  const [revision, setRevision] = createSignal(0);
  const [overrides, setOverrides] = createSignal(
    new Map<string, IUser | null>()
  );
  const [createdIds, setCreatedIds] = createSignal<readonly string[]>([]);
  const [progress, setProgress] = createSignal<ImportProgress>({
    type: 'idle',
  });
  const [isImporting, setIsImporting] = createSignal(false);

  const runningProgress = createMemo(() => {
    const p = progress();
    return p.type === 'running' ? p : null;
  });

  const doneProgress = createMemo(() => {
    const p = progress();
    return p.type === 'done' ? p : null;
  });

  const uniqueAssignees = createMemo(() => {
    const set = new Set<string>();
    for (const r of records()) {
      const a = normalize(r['Assignee'] ?? '');
      if (a) set.add(a);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  const assignees = useImportAssignees(
    props.account,
    () => (progress().type === 'idle' ? uniqueAssignees() : []),
    revision
  );
  const assigned = (label: string): IUser | null => {
    if (overrides().has(label)) return overrides().get(label) ?? null;
    const match = assignees.match(label);
    return match.kind === 'matched' ? match.person : null;
  };
  const unresolved = () =>
    uniqueAssignees().some(
      (label) =>
        !overrides().has(label) &&
        ['pending', 'unavailable'].includes(assignees.match(label).kind)
    );
  const unavailable = () =>
    uniqueAssignees().some(
      (label) =>
        !overrides().has(label) && assignees.match(label).kind === 'unavailable'
    );

  const previewDrafts = createMemo(() => {
    const allRows = records();

    const allDrafts = allRows.map((r, index) => {
      const assigneeRaw = normalize(r['Assignee'] ?? '');
      const assigneeUserId = assigneeRaw
        ? assigned(assigneeRaw)?.id
        : undefined;
      return {
        rowNum: index + 1,
        ...linearCsvRecordToMacroTaskDraft({
          record: r,
          assigneeUserId: assigneeUserId ? assigneeUserId : null,
        }),
      };
    });

    // Show first 20 plus any additional rows with warnings
    return allDrafts.filter((d, i) => i < 20 || d.warnings.length > 0);
  });

  const handleFileChange = async (file: File | undefined) => {
    if (isImporting() || !current()) return;
    const version = revision() + 1;
    batch(() => {
      setRevision(version);
      setOverrides(new Map());
      setCreatedIds([]);
      setProgress({ type: 'idle' });
      setParseError('');
      setRecords([]);
      setFileName(file?.name ?? '');
    });
    if (!file) {
      if (fileInput) fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      if (!current() || version !== revision()) return;
      const result = parseCsv(text);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      // Linear exports use quoted headers; the parser returns them unquoted.
      setRecords(result.records);
    } catch {
      if (current() && version === revision())
        setParseError('Could not read the CSV file.');
    }
  };

  const canImport = () =>
    current() &&
    records().length > 0 &&
    !parseError() &&
    !isImporting() &&
    progress().type === 'idle' &&
    !unresolved();

  const runImport = async () =>
    Telemetry.span('linear_import.create_tasks', async (span) => {
      if (!canImport()) return;
      const rows = records();
      span.setAttr('import.row_count', rows.length);
      // Submission owns these identities even if metadata finishes during creation.
      const selection = new Map(
        uniqueAssignees().map((label) => {
          const person = assigned(label);
          return [
            label,
            person
              ? { id: person.id, email: person.email, name: person.name }
              : null,
          ] as const;
        })
      );
      const mapping = new Map(
        [...selection].map(([label, person]) => [label, person?.id])
      );
      batch(() => {
        setOverrides(selection);
        setIsImporting(true);
        setCreatedIds([]);
        setProgress({ type: 'running', done: 0, total: rows.length });
      });

      let created = 0;
      let skipped = 0;
      let failed = 0;
      const createdList: string[] = [];

      try {
        for (let i = 0; i < rows.length; i++) {
          if (!current()) return;
          const r = rows[i];
          const assigneeRaw = normalize(r['Assignee'] ?? '');
          const assigneeUserId = assigneeRaw
            ? mapping.get(assigneeRaw)
            : undefined;

          const draft = linearCsvRecordToMacroTaskDraft({
            record: r,
            assigneeUserId: assigneeUserId ? assigneeUserId : null,
          });

          if (!draft.title) {
            skipped++;
            setProgress({ type: 'running', done: i + 1, total: rows.length });
            continue;
          }

          let id: string | undefined;
          try {
            id = await createTaskForAccount(props.account, {
              title: draft.title,
              content: draft.content,
              propertyValues: draft.propertyValues,
            });
          } catch {
            if (!current()) return;
          }
          if (!current()) return;

          if (!id) {
            failed++;
          } else {
            created++;
            createdList.push(id);
            upsertToHistory.mutate({ itemId: id, itemType: 'document' });
          }

          setProgress({ type: 'running', done: i + 1, total: rows.length });
        }

        // Refresh soup items so the new tasks appear.
        queryClient.invalidateQueries({ queryKey: soupKeys.astItems._def });

        setCreatedIds(createdList);
        setProgress({ type: 'done', created, skipped, failed });
        toast.success(`Imported ${created} tasks`);
        if (failed > 0) toast.failure(`${failed} tasks failed to import`);
      } finally {
        span.setAttr('import.created', created);
        span.setAttr('import.skipped', skipped);
        span.setAttr('import.failed', failed);
        span.setAttr('import.scope_current', current());
        setIsImporting(false);
      }
    });

  return (
    <div class="flex flex-col size-full">
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div class="text-lg font-medium text-ink">Import Linear CSV</div>
          <Button
            variant="secondary"
            disabled={isImporting()}
            onClick={() =>
              fireAndForget(handleFileChange(undefined), 'linear-import')
            }
          >
            Clear
          </Button>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-ink-muted">CSV file</label>
          <label class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-contrast font-medium rounded-md hover:bg-accent-hover transition-colors w-fit">
            <span>Choose File</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              disabled={isImporting()}
              onChange={(e) =>
                fireAndForget(
                  handleFileChange(e.currentTarget.files?.[0]),
                  'linear-import'
                )
              }
              class="sr-only"
            />
          </label>
          <Show when={fileName()}>
            <div class="text-sm text-ink">
              <span class="text-ink-muted">Loaded:</span> {fileName()}
            </div>
          </Show>
          <Show when={parseError()}>
            <div class="text-sm text-failure-ink">{parseError()}</div>
          </Show>
        </div>

        <Show when={records().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-sm text-ink-muted">
              Rows: <span class="text-ink">{records().length}</span>
            </div>

            <Show when={uniqueAssignees().length > 0}>
              <div class="flex flex-col gap-2">
                <div class="text-sm font-medium text-ink">Assignee mapping</div>
                <div class="text-xs text-ink-muted">
                  Unmatched or ambiguous assignees import as unassigned unless
                  you map them here. If lookup is unavailable, choose an
                  assignee or explicitly choose Unassigned.
                </div>

                <Show when={unavailable()}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isImporting()}
                    onClick={() =>
                      fireAndForget(assignees.retry(), 'linear-import')
                    }
                  >
                    Retry assignee lookup
                  </Button>
                </Show>
                <div class="flex flex-col gap-2 border border-edge rounded-sm p-2">
                  <For each={uniqueAssignees()}>
                    {(assignee) => (
                      <div class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-ink truncate">
                            {assignee}
                          </div>
                        </div>
                        <div class="min-w-0 max-w-full flex flex-col gap-1">
                          <ImportAssigneePicker
                            label={assignee}
                            person={assigned(assignee)}
                            disabled={progress().type !== 'idle'}
                            onChange={(person) =>
                              setOverrides((values) =>
                                new Map(values).set(assignee, person)
                              )
                            }
                          />
                          <Show when={!overrides().has(assignee)}>
                            <span class="text-xs text-ink-muted">
                              <Switch>
                                <Match
                                  when={
                                    assignees.match(assignee).kind === 'pending'
                                  }
                                >
                                  Resolving…
                                </Match>
                                <Match
                                  when={
                                    assignees.match(assignee).kind ===
                                    'unavailable'
                                  }
                                >
                                  Lookup unavailable
                                </Match>
                                <Match
                                  when={
                                    assignees.match(assignee).kind ===
                                    'ambiguous'
                                  }
                                >
                                  Multiple exact matches
                                </Match>
                                <Match
                                  when={
                                    assignees.match(assignee).kind ===
                                    'unmatched'
                                  }
                                >
                                  No exact match
                                </Match>
                              </Switch>
                            </span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={records().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium text-ink">
              Preview (first 20 + all rows with warnings)
            </div>
            <div class="border border-edge rounded-sm overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-hover">
                  <tr class="text-left">
                    <th class="p-2">Row</th>
                    <th class="p-2">Title</th>
                    <th class="p-2">Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={previewDrafts()}>
                    {(d) => (
                      <tr class="border-t border-edge">
                        <td class="p-2 align-top">
                          <div class="text-ink-muted">{d.rowNum}</div>
                        </td>
                        <td class="p-2 align-top">
                          <div class="text-ink">
                            {d.title || '(missing title)'}
                          </div>
                        </td>
                        <td class="p-2 align-top">
                          <div class="text-xs text-ink-muted">
                            {d.warnings.length > 0
                              ? d.warnings.join(' · ')
                              : '—'}
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>

        <Show when={createdIds().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium text-ink">Created tasks</div>
            <div class="flex flex-col gap-1">
              <For each={createdIds()}>
                {(id) => (
                  <a
                    class="text-sm text-link hover:text-link-hover visited:text-link-visited underline underline-offset-2"
                    href={buildSimpleEntityUrl({ type: 'task', id })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {id}
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <div class="border-t border-edge p-4 flex items-center gap-3 shrink-0">
        <Button
          variant="primary"
          onClick={() => fireAndForget(runImport(), 'linear-import')}
          disabled={!canImport()}
        >
          Import tasks
        </Button>
        <Show when={runningProgress()}>
          {(p) => (
            <div class="text-sm text-ink-muted">
              Importing… {p().done}/{p().total}
            </div>
          )}
        </Show>
        <Show when={doneProgress()}>
          {(p) => (
            <div class="text-sm text-ink-muted">
              Done — created {p().created}, skipped {p().skipped}, failed{' '}
              {p().failed}
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
