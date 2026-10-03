import { Button, Dialog } from '@ui';
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
import { ConversationPicker } from '../components/conversation-picker';
import { ImportProgress } from '../components/import-progress';
import { SlackImportCard } from '../components/slack-import-card';
import type { ImportJob } from '../context/contracts';
import { useImportContext } from '../context/import-context';
import {
  createImportController,
  type ImportController,
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
  const localActive = () => {
    const phase = controller()?.phase();
    return phase !== undefined && !['monitoring', 'terminal'].includes(phase);
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
    setActionError(undefined);
    setSelected(new Set<string>());
    setConfirmed(false);
    setFilter('');
    setShowArchived(false);
    setIncludeHistory(true);
  }

  function changeOpen(next: boolean): void {
    if (!next) {
      const phase = controller()?.phase();
      if (phase === 'idle' || phase === 'discovering' || phase === 'selecting')
        resetSession();
    }
    setOpen(next);
  }

  async function chooseFile(file: File | undefined): Promise<void> {
    const page = source.page();
    if (!file || !page || localActive()) return;
    resetSession();
    setJobId(undefined);
    setHistoryReceipt(undefined);
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
    if (controller()?.phase() !== 'selecting') return;
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const discovery = () => controller()?.discovery();
  const canCancel = () =>
    (controller() && controller()?.phase() !== 'terminal') ||
    (job() && !terminal(job()!));
  const cancelPending = () =>
    cancelling() ||
    controller()?.phase() === 'cancelling' ||
    job()?.status === 'cancelling';
  const canChooseAnother = () =>
    controller() &&
    (!localActive() ||
      controller()?.phase() === 'selecting' ||
      (controller()?.phase() === 'interrupted' && !discovery()));
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
        onCloseAutoFocus={(event) => {
          // The card is outside Dialog's trigger context; retain its focus owner.
          event.preventDefault();
          if (!open()) opener?.focus();
        }}
      >
        <div class="max-h-[85dvh] overflow-y-auto p-4 sm:p-6 flex flex-col gap-4 text-ink">
          <Dialog.Title class="text-lg font-semibold">
            Import from Slack
          </Dialog.Title>
          <Dialog.Description class="text-sm text-ink-muted">
            Select a Slack export ZIP. Parsing stays in your browser; only
            selected conversation data is uploaded. Keep this Settings page open
            until uploads finish.
          </Dialog.Description>
          <label class="flex flex-col gap-1 text-sm">
            Slack export ZIP
            {/* The mobile focus trap requires tabindex=-1 even on disabled inputs. */}
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={fileDisabled()}
              tabIndex={fileDisabled() ? -1 : undefined}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void runAction(() => chooseFile(file));
              }}
            />
          </label>
          <p class="text-xs text-ink-muted">
            Files, attachments and attachment-only messages are not imported.
            Encrypted, multi-volume and ZIP64 archives are unsupported. This is
            not a live Slack connection.
          </p>
          <Show when={!source.page() && !source.error()}>
            <p role="status">Loading import settings…</p>
          </Show>
          <Show when={source.error()}>
            <p role="alert">
              Progress could not be refreshed. Existing server imports may still
              be running.
            </p>
          </Show>
          <Show when={error()}>{(error) => <p role="alert">{error()}</p>}</Show>
          <Show when={warning()}>
            {(warning) => <p role="status">{warning()}</p>}
          </Show>
          <Show when={controller()?.phase() === 'selecting' && discovery()}>
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
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeHistory()}
                    onChange={(event) =>
                      setIncludeHistory(event.currentTarget.checked)
                    }
                  />
                  Include message history
                </label>
                <p class="text-sm text-ink-muted">
                  {found().users.length - namedAuthors()} source users have
                  email attribution; {namedAuthors()} use Slack-name attribution
                  via the system bot. Emails are lowercased as exported, without
                  alias matching or a team roster lookup. External email
                  addresses can become channel members. DMs require two distinct
                  email-bearing members; importing never adds you as a third
                  member.
                </p>
                <p class="text-sm text-ink-muted">
                  Public Slack channels become Team channels with explicit
                  members, never globally Public. Existing channel names, roles
                  and membership history are preserved.
                </p>
                <p class="text-sm">
                  Team source: {boundSource()}. Archive source:{' '}
                  {archiveSource()}.
                </p>
                <label class="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="mt-1"
                    checked={confirmed()}
                    onChange={(event) =>
                      setConfirmed(event.currentTarget.checked)
                    }
                  />
                  I confirm this archive belongs to this team's Slack workspace,
                  including when its identity is unknown. The source binding is
                  immutable; this team cannot import another Slack workspace.
                </label>
                <Button
                  variant="strong"
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
              </>
            )}
          </Show>
          <Show when={controller() || job()}>
            <ImportProgress
              job={job()}
              phase={controller()?.phase()}
              upload={controller()?.uploadProgress()}
              channelHref={props.channelHref}
            />
          </Show>
          <p class="text-xs text-ink-muted">
            Cancellation stops future work, not work already committed. Running
            conversations may finish. Imported channels and messages are not
            rolled back.
          </p>
          <Show when={!controller() && job()?.status === 'uploading'}>
            <p class="text-sm text-ink-muted">
              Server progress has been recovered without the ZIP. Local uploads
              do not resume after reload. Finalize with skips to process
              verified conversations, or cancel and confirm a new import.
            </p>
            <Button
              disabled={busy() || cancelling()}
              onClick={() => void runAction(finalizeHistory)}
            >
              Finalize with skips
            </Button>
          </Show>
          <div class="flex flex-wrap gap-2">
            <Show when={controller()?.phase() === 'interrupted' && discovery()}>
              <Show
                when={controller()?.job()}
                fallback={
                  <Button
                    disabled={busy()}
                    onClick={() =>
                      void runAction(() => controller()!.recoverJob())
                    }
                  >
                    Recover job receipt
                  </Button>
                }
              >
                <Button
                  disabled={busy()}
                  onClick={() =>
                    void runAction(() => controller()!.finalizeWithSkips())
                  }
                >
                  Finalize with skips
                </Button>
              </Show>
            </Show>
            <Show when={canCancel()}>
              <Button disabled={cancelPending()} onClick={() => void cancel()}>
                Cancel import (keep partial results)
              </Button>
            </Show>
            <Show when={canChooseAnother()}>
              <Button disabled={busy() || cancelling()} onClick={resetSession}>
                Choose another archive
              </Button>
            </Show>
            <Button
              disabled={busy()}
              onClick={() => void runAction(() => source.refresh())}
            >
              Refresh progress
            </Button>
            <Button onClick={() => changeOpen(false)}>Close</Button>
          </div>
          <section class="flex flex-col gap-2" aria-label="Job history">
            <h3 class="font-medium">Job history</h3>
            <Index each={source.page()?.jobs}>
              {(receipt) => (
                <Button
                  class="h-auto break-all text-left justify-start"
                  disabled={localActive() || busy()}
                  onClick={() => {
                    resetSession();
                    setHistoryReceipt(undefined);
                    setJobId(receipt().jobId);
                  }}
                >
                  {receipt().createdAt || receipt().jobId} ·{' '}
                  {receipt().status.replaceAll('_', ' ')}
                </Button>
              )}
            </Index>
            <Show when={source.page()?.jobs.length === 0}>
              <p class="text-sm text-ink-muted">No imports on this page.</p>
            </Show>
            <div class="flex flex-wrap gap-2">
              <Show when={before()}>
                <Button onClick={() => setBefore(undefined)}>
                  Newest imports
                </Button>
              </Show>
              <Show when={source.page()?.nextCursor}>
                <Button onClick={() => setBefore(source.page()?.nextCursor)}>
                  Older imports
                </Button>
              </Show>
            </div>
          </section>
        </div>
      </Dialog>
    </>
  );
}
