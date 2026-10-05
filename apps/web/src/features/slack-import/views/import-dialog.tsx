import { formatDate } from '@core/util/date';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import FileZipIcon from '@phosphor/file-zip.svg';
import { ActionDialogShell, Button, cn, Dialog } from '@ui';
import {
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  Index,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ConversationPicker } from '../components/conversation-picker';
import { ImportProgress } from '../components/import-progress';
import {
  DialogSectionTitle,
  formatBytes,
  humanize,
  jobTone,
  NativeCheckbox,
  Notice,
  type StatusDisplay,
  StatusDot,
} from '../components/import-ui';
import { SlackImportCard } from '../components/slack-import-card';
import type { ImportJob, ImportPage } from '../context/contracts';
import { useImportContext } from '../context/import-context';
import {
  createImportController,
  type ImportController,
  type ImportPhase,
} from '../primitives/import-controller';

type Props = {
  teamId: string;
  onCompleted(job: ImportJob): Promise<void>;
  channelHref(id: string): string | undefined;
};

function terminal(job: ImportJob): boolean {
  return ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(
    job.status
  );
}

/** Phases before any server write; closing the dialog here discards the archive. */
const REVIEW_PHASES = new Set<ImportPhase>([
  'idle',
  'discovering',
  'selecting',
]);
/** Phases during which the upload summary is meaningful. */
const UPLOAD_PHASES = new Set<ImportPhase>([
  'preparing',
  'uploading',
  'interrupted',
  'finalizing',
  'cancelling',
  'monitoring',
  'terminal',
]);

const SOURCE_CONFIRMATION =
  "I confirm this archive belongs to this team's Slack workspace, including when its identity is unknown.";

function phaseDisplay(phase: ImportPhase): StatusDisplay {
  const tone = match(phase)
    .with('idle', 'disposed', () => 'neutral' as const)
    .with(
      'discovering',
      'selecting',
      'preparing',
      'uploading',
      'finalizing',
      'monitoring',
      () => 'active' as const
    )
    .with('interrupted', 'cancelling', () => 'warning' as const)
    .with('terminal', () => 'success' as const)
    .exhaustive();
  return { tone, label: humanize(phase) };
}

/** Confirmed jobs outlive dialog content; closing an unconfirmed review discards its file. */
export function ImportDialog(props: Props): JSX.Element {
  const context = useImportContext();
  const owner = getOwner();
  const [open, setOpen] = createSignal(false);
  let opener: HTMLButtonElement | undefined;
  const [jobId, setJobId] = createSignal<string>();
  const [before, setBefore] = createSignal<string>();
  const { source, commands } = context.createSource({
    teamId: () => props.teamId,
    jobId,
    enabled: () => true,
    before,
  });
  const [controller, setController] = createSignal<ImportController>();
  const [archive, setArchive] = createSignal<{ name: string; size: number }>();
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = createSignal('');
  const [showArchived, setShowArchived] = createSignal(false);
  const [includeHistory, setIncludeHistory] = createSignal(true);
  const [confirmed, setConfirmed] = createSignal(false);
  const [actionError, setActionError] = createSignal<string>();
  const [refreshWarning, setRefreshWarning] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [historyReceipt, setHistoryReceipt] = createSignal<ImportJob>();
  let disposeSession: (() => void) | undefined;
  onCleanup(() => disposeSession?.());

  const job = (): ImportJob | undefined => {
    const current = controller()?.job();
    if (current) return current;
    const observed = source.job();
    const saved = historyReceipt();
    if (
      saved &&
      saved.jobId === jobId() &&
      (!observed || saved.revision > observed.revision)
    )
      return saved;
    return observed ?? source.page()?.jobs.find((job) => job.jobId === jobId());
  };
  const phase = () => controller()?.phase();
  const localActive = () => {
    const current = phase();
    return (
      current !== undefined && !['monitoring', 'terminal'].includes(current)
    );
  };
  const observedCompletions = new Set<string>();
  async function refreshCompleted(job: ImportJob): Promise<void> {
    try {
      await props.onCompleted(job);
    } catch {
      setRefreshWarning(
        'Import results are saved, but channel lists could not be refreshed.'
      );
    }
  }
  // Cache invalidation is an imperative host effect, never derived feature state.
  createEffect(
    on(
      () => [...(source.page()?.jobs ?? []), ...(job() ? [job()!] : [])],
      (jobs) => {
        for (const receipt of jobs) {
          if (!terminal(receipt) || observedCompletions.has(receipt.jobId))
            continue;
          observedCompletions.add(receipt.jobId);
          void refreshCompleted(receipt);
        }
      }
    )
  );

  function resetSession(): void {
    disposeSession?.();
    disposeSession = undefined;
    setController(undefined);
    setArchive(undefined);
    setActionError(undefined);
    setSelected(new Set<string>());
    setConfirmed(false);
    setFilter('');
    setShowArchived(false);
    setIncludeHistory(true);
  }

  function changeOpen(next: boolean): void {
    if (!next) {
      const current = phase();
      if (current === undefined || REVIEW_PHASES.has(current)) resetSession();
    }
    setOpen(next);
  }

  async function chooseFile(file: File | undefined): Promise<void> {
    const page = source.page();
    if (!file || !page || localActive()) return;
    resetSession();
    setJobId(undefined);
    setHistoryReceipt(undefined);
    setArchive({ name: file.name, size: file.size });
    const session = createRoot((dispose) => {
      disposeSession = dispose;
      return createImportController({
        teamId: props.teamId,
        limits: page.limits,
        sourceBinding: () => source.page()?.sourceBinding ?? page.sourceBinding,
        archive: context.createArchive(),
        commands,
        source,
        protectFile: context.protectFile,
        newToken: context.newToken,
        async onJobCreated(job) {
          setJobId(job.jobId);
        },
      });
    }, owner);
    setController(session);
    await session.discover(file);
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The action could not be completed.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function finalizeHistory(): Promise<void> {
    const receipt = job();
    if (!receipt || receipt.status !== 'uploading' || controller()) return;
    setHistoryReceipt(
      await commands.finalize({ teamId: props.teamId, jobId: receipt.jobId })
    );
  }

  async function cancel(): Promise<void> {
    if (cancelling()) return;
    setCancelling(true);
    setActionError(undefined);
    try {
      const active = controller();
      if (active) return await active.cancel();
      const receipt = job();
      if (!receipt || terminal(receipt)) return;
      setHistoryReceipt(
        await commands.cancel({ teamId: props.teamId, jobId: receipt.jobId })
      );
    } catch {
      setActionError(
        'Cancellation was not confirmed. Refresh progress or retry cancel.'
      );
    } finally {
      setCancelling(false);
    }
  }

  function select(ids: string[], checked: boolean): void {
    if (phase() !== 'selecting') return;
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openHistory(receipt: ImportJob): void {
    resetSession();
    setHistoryReceipt(undefined);
    setJobId(receipt.jobId);
  }

  const discovery = () => controller()?.discovery();
  const canCancel = () =>
    (controller() && phase() !== 'terminal') || (job() && !terminal(job()!));
  const cancelPending = () =>
    cancelling() || phase() === 'cancelling' || job()?.status === 'cancelling';
  const canChooseAnother = () =>
    controller() &&
    (!localActive() ||
      phase() === 'selecting' ||
      (phase() === 'interrupted' && !discovery()));
  const fileDisabled = () => !source.page() || localActive() || busy();
  const error = () => actionError() ?? controller()?.error();
  const warning = () => refreshWarning() ?? controller()?.warning();
  const unsupported = () =>
    new Set(
      controller()
        ?.skips()
        .filter((skip) => skip.reason === 'unsupported_dm')
        .map((skip) => skip.slackChannelId)
    );
  const namedAuthors = () =>
    discovery()?.users.filter(
      (user) => !user.profile?.email || user.is_bot || user.id === 'USLACKBOT'
    ).length ?? 0;
  const archiveSource = (): string => {
    const source = discovery()?.source;
    return source?.kind === 'known' ? source.sourceId : 'Unknown';
  };
  const boundSource = () => {
    const binding = source.page()?.sourceBinding;
    if (!binding || binding.kind === 'unbound') return 'Not yet bound';
    return binding.kind === 'known'
      ? binding.sourceId
      : 'Previously confirmed unknown workspace';
  };
  const upload = () => {
    const current = phase();
    return current && UPLOAD_PHASES.has(current)
      ? controller()?.uploadProgress()
      : undefined;
  };
  const recoveredUpload = () => !controller() && job()?.status === 'uploading';
  const showProgress = () => {
    const current = phase();
    return Boolean(job() || (current && !REVIEW_PHASES.has(current)));
  };

  const primaryAction = (): JSX.Element => {
    const current = phase();
    if (current === 'selecting') {
      return (
        <Button
          variant="strong"
          depth={2}
          disabled={!selected().size || !confirmed() || busy()}
          onClick={() =>
            void runAction(() =>
              controller()!.start({
                selectedIds: [...selected()],
                includeMessageHistory: includeHistory(),
                sourceConfirmed: confirmed(),
              })
            )
          }
        >
          Import selected channels ({selected().size})
        </Button>
      );
    }
    if (current === 'interrupted' && discovery()) {
      return (
        <Show
          when={controller()?.job()}
          fallback={
            <Button
              variant="strong"
              depth={2}
              disabled={busy()}
              onClick={() => void runAction(() => controller()!.recoverJob())}
            >
              Recover job receipt
            </Button>
          }
        >
          <Button
            variant="strong"
            depth={2}
            disabled={busy()}
            onClick={() =>
              void runAction(() => controller()!.finalizeWithSkips())
            }
          >
            Finalize with skips
          </Button>
        </Show>
      );
    }
    if (recoveredUpload()) {
      return (
        <Button
          variant="strong"
          depth={2}
          disabled={busy() || cancelling()}
          onClick={() => void runAction(finalizeHistory)}
        >
          Finalize with skips
        </Button>
      );
    }
    return null;
  };

  return (
    <>
      <SlackImportCard
        onOpen={(trigger) => {
          opener = trigger;
          setOpen(true);
        }}
      />
      <Dialog
        open={open()}
        onOpenChange={changeOpen}
        position="center"
        class="w-160"
        visibleScrim
        onCloseAutoFocus={(event) => {
          // The card is outside Dialog's trigger context; retain its focus owner.
          event.preventDefault();
          if (!open()) opener?.focus();
        }}
      >
        <ActionDialogShell class="max-h-[85dvh]">
          <ActionDialogShell.Body class="space-y-6">
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                Import from Slack
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                Bring conversations from a Slack export into this team. The
                archive is read in your browser and only the conversations you
                select are uploaded. Keep this page open until uploads finish.
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>

            <ArchivePicker
              archive={archive()}
              disabled={fileDisabled()}
              reading={phase() === 'discovering'}
              onChoose={(file) => void runAction(() => chooseFile(file))}
            />

            <Show when={!source.page() && !source.error()}>
              <Notice tone="info">Loading import settings…</Notice>
            </Show>
            <Show when={source.error()}>
              <Notice tone="warning">
                Progress could not be refreshed. Imports already running on the
                server continue.
              </Notice>
            </Show>
            <Show when={error()}>
              {(error) => <Notice tone="error">{error()}</Notice>}
            </Show>
            <Show when={warning()}>
              {(warning) => <Notice tone="warning">{warning()}</Notice>}
            </Show>

            <Show when={phase() === 'selecting' && discovery()}>
              {(found) => (
                <>
                  <ConversationPicker
                    discovery={found()}
                    selected={selected()}
                    unsupported={unsupported()}
                    filter={filter()}
                    showArchived={showArchived()}
                    onFilter={setFilter}
                    onShowArchived={setShowArchived}
                    onSelect={select}
                  />
                  <section class="flex flex-col gap-3" aria-label="Options">
                    <DialogSectionTitle>Options</DialogSectionTitle>
                    <div class="divide-y divide-edge-divider overflow-hidden rounded-lg border border-edge-muted">
                      <label class="flex items-start gap-3 px-4 py-3">
                        <NativeCheckbox
                          class="mt-0.5"
                          checked={includeHistory()}
                          aria-label="Include message history"
                          aria-describedby="slack-import-history-hint"
                          onChange={(event) =>
                            setIncludeHistory(event.currentTarget.checked)
                          }
                        />
                        <span class="min-w-0 flex-1">
                          <span class="block text-sm text-ink">
                            Include message history
                          </span>
                          <span
                            id="slack-import-history-hint"
                            class="block text-xs text-ink-muted"
                          >
                            Messages, threads and reactions are imported with
                            each conversation. Files, attachments and
                            attachment-only messages are skipped.
                          </span>
                        </span>
                      </label>
                      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
                        <dt class="text-ink-muted">Team source</dt>
                        <dd class="min-w-0 truncate text-ink">
                          {boundSource()}
                        </dd>
                        <dt class="text-ink-muted">Archive source</dt>
                        <dd class="min-w-0 truncate text-ink">
                          {archiveSource()}
                        </dd>
                        <dt class="text-ink-muted">Members</dt>
                        <dd class="text-ink">
                          {found().users.length - namedAuthors()} matched by
                          email · {namedAuthors()} attributed by Slack name
                        </dd>
                      </dl>
                      <label class="flex items-start gap-3 px-4 py-3">
                        <NativeCheckbox
                          class="mt-0.5"
                          checked={confirmed()}
                          aria-label={SOURCE_CONFIRMATION}
                          aria-describedby="slack-import-source-hint"
                          onChange={(event) =>
                            setConfirmed(event.currentTarget.checked)
                          }
                        />
                        <span class="min-w-0 flex-1">
                          <span class="block text-sm text-ink">
                            {SOURCE_CONFIRMATION}
                          </span>
                          <span
                            id="slack-import-source-hint"
                            class="block text-xs text-ink-muted"
                          >
                            The source binding is permanent: this team cannot
                            import another Slack workspace later.
                          </span>
                        </span>
                      </label>
                    </div>
                    <p class="text-xs text-ink-extra-muted">
                      Public Slack channels become Team channels with explicit
                      members, never globally public. Existing channel names,
                      roles and membership history are preserved. External email
                      addresses can become channel members; a DM needs two
                      distinct email-bearing members and never adds you as a
                      third.
                    </p>
                  </section>
                </>
              )}
            </Show>

            <Show when={showProgress()}>
              <ImportProgress
                job={job()}
                phase={phase() ? phaseDisplay(phase()!) : undefined}
                upload={upload()}
                channelHref={props.channelHref}
              />
            </Show>
            <Show when={recoveredUpload()}>
              <Notice tone="warning">
                Progress was recovered without the archive, and uploads do not
                resume after a reload. Finalize with skips to process the
                verified conversations, or cancel and start a new import.
              </Notice>
            </Show>

            <JobHistory
              page={source.page()}
              activeJobId={jobId()}
              disabled={localActive() || busy()}
              paged={Boolean(before())}
              onOpen={openHistory}
              onNewest={() => setBefore(undefined)}
              onOlder={() => setBefore(source.page()?.nextCursor)}
            />
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer class="justify-between">
            <Button
              variant="ghost"
              depth={2}
              disabled={busy()}
              onClick={() => void runAction(() => source.refresh())}
            >
              <ArrowsClockwiseIcon aria-hidden="true" class="size-4" />
              Refresh progress
            </Button>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={canCancel()}>
                <Button
                  variant="ghost"
                  depth={2}
                  class="text-failure hover:text-failure"
                  disabled={cancelPending()}
                  onClick={() => void cancel()}
                >
                  Cancel import
                </Button>
              </Show>
              <Show when={canChooseAnother()}>
                <Button
                  variant="ghost"
                  depth={2}
                  disabled={busy() || cancelling()}
                  onClick={resetSession}
                >
                  Choose another archive
                </Button>
              </Show>
              <Button
                variant="ghost"
                depth={2}
                onClick={() => changeOpen(false)}
              >
                Close
              </Button>
              {primaryAction()}
            </div>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </Dialog>
    </>
  );
}

/**
 * The archive drop zone. The native input stays in the DOM (visually hidden)
 * so the accessible name, focus order and file dialog remain native.
 */
function ArchivePicker(props: {
  archive: { name: string; size: number } | undefined;
  disabled: boolean;
  reading: boolean;
  onChoose(file: File | undefined): void;
}): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const accept = (file: File | undefined) => {
    setDragging(false);
    if (props.disabled) return;
    props.onChoose(file);
  };
  return (
    <section class="flex flex-col gap-3" aria-label="Archive">
      <DialogSectionTitle>Archive</DialogSectionTitle>
      <div
        class={cn(
          'relative flex items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors',
          dragging()
            ? 'border-accent bg-accent-bg'
            : 'border-edge-frame bg-control',
          props.disabled ? 'opacity-60' : 'hover:border-edge hover:bg-ink/4'
        )}
        onDragOver={(event) => {
          if (props.disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          accept(event.dataTransfer?.files?.[0]);
        }}
      >
        {/* The mobile focus trap requires tabindex=-1 even on disabled inputs. */}
        <input
          id="slack-import-file"
          type="file"
          accept=".zip,application/zip"
          class="peer sr-only"
          aria-labelledby="slack-import-file-label"
          aria-describedby="slack-import-file-hint"
          disabled={props.disabled}
          tabIndex={props.disabled ? -1 : undefined}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            accept(file);
          }}
        />
        <label
          for="slack-import-file"
          aria-hidden="true"
          class="absolute inset-0 rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        />
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-muted">
          <FileZipIcon aria-hidden="true" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div
            id="slack-import-file-label"
            class="text-sm font-medium text-ink"
          >
            Slack export ZIP
          </div>
          <div
            id="slack-import-file-hint"
            class="truncate text-xs text-ink-muted"
          >
            <Show
              when={props.archive}
              fallback="Drop the .zip exported from Slack here, or browse for it."
            >
              {(archive) => (
                <>
                  {archive().name} · {formatBytes(archive().size)}
                  {props.reading ? ' · Reading archive…' : ''}
                </>
              )}
            </Show>
          </div>
        </div>
        <Show when={!props.disabled}>
          <span class="shrink-0 text-sm font-medium text-ink-muted">
            Browse
          </span>
        </Show>
      </div>
      <p class="text-xs text-ink-extra-muted">
        Encrypted, multi-volume and ZIP64 archives are not supported. This is a
        one-time import, not a live Slack connection.
      </p>
    </section>
  );
}

function JobHistory(props: {
  page: ImportPage | undefined;
  activeJobId: string | undefined;
  disabled: boolean;
  paged: boolean;
  onOpen(job: ImportJob): void;
  onNewest(): void;
  onOlder(): void;
}): JSX.Element {
  const when = (receipt: ImportJob): JSX.Element =>
    receipt.createdAt ? (
      <time dateTime={receipt.createdAt}>
        {formatDate(receipt.createdAt, { showTime: true })}
      </time>
    ) : (
      receipt.jobId
    );
  return (
    <section class="flex flex-col gap-3" aria-label="Job history">
      <DialogSectionTitle>Previous imports</DialogSectionTitle>
      <Show
        when={props.page?.jobs.length}
        fallback={
          <p class="text-xs text-ink-muted">
            {props.paged
              ? 'No older imports.'
              : 'No imports yet for this team.'}
          </p>
        }
      >
        <ul class="divide-y divide-edge-divider overflow-hidden rounded-lg border border-edge-muted">
          <Index each={props.page?.jobs}>
            {(receipt) => (
              <li>
                <button
                  type="button"
                  class={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-ink/4 focus-visible:bg-ink/6 disabled:pointer-events-none disabled:opacity-50',
                    receipt().jobId === props.activeJobId && 'bg-ink/4'
                  )}
                  aria-current={
                    receipt().jobId === props.activeJobId ? 'true' : undefined
                  }
                  disabled={props.disabled}
                  onClick={() => props.onOpen(receipt())}
                >
                  <StatusDot tone={jobTone(receipt().status)} />
                  <span class="min-w-0 flex-1 truncate text-ink">
                    {when(receipt())} · {humanize(receipt().status)}
                  </span>
                  <span class="shrink-0 text-xs text-ink-muted">
                    {receipt().conversations.length}{' '}
                    {receipt().conversations.length === 1
                      ? 'conversation'
                      : 'conversations'}{' '}
                    ·{' '}
                    {receipt().includeMessageHistory
                      ? 'With history'
                      : 'Without history'}
                  </span>
                  <CaretRightIcon
                    aria-hidden="true"
                    class="size-4 shrink-0 text-ink-extra-muted"
                  />
                </button>
              </li>
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.paged || props.page?.nextCursor}>
        <div class="flex items-center gap-2">
          <Show when={props.paged}>
            <Button
              variant="outline"
              size="sm"
              depth={2}
              onClick={props.onNewest}
            >
              Newest imports
            </Button>
          </Show>
          <Show when={props.page?.nextCursor}>
            <Button
              variant="outline"
              size="sm"
              depth={2}
              onClick={props.onOlder}
            >
              Older imports
            </Button>
          </Show>
        </div>
      </Show>
    </section>
  );
}
