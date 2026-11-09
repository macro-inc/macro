import { TutorialPill } from '@app/features/video-tutorials';
import { useCodexAgentsAccess } from '@core/codex/flag';
import { toast } from '@core/component/Toast/Toast';
import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import {
  useCursorApiKeyStatusQuery,
  useDisconnectCursorApiKey,
  useSaveCursorApiKey,
} from '@queries/auth/cursor-api-key';
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
  usePatchHarnessMutation,
} from '@queries/harnesses/harnesses';
import { useIsTeamOwner } from '@queries/team/teams';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { useSearchParams } from '@solidjs/router';
import { ApiKeyInput, Button, confirmDialog, Dialog, Input, Panel } from '@ui';
import { createEffect, createSignal, on, onMount, Show } from 'solid-js';
import { CodexHarness } from './codex/views/CodexHarness';
import { ConnectedRuntimesSection } from './components/connected-runtimes-section';
import { CursorDefaultModel } from './components/cursor-default-model';
import { LocalRuntimeCard } from './components/local-runtime-card';
import { SettingsSearchTarget } from './components/settings-search-target';
import { TeammateRuntimesSection } from './components/teammate-runtimes-section';
import {
  CURSOR_KEY_FORMAT_ERROR,
  CURSOR_KEY_PREFIX,
  isCursorApiKey,
} from './core/cursor-api-key';
import { HarnessIcon } from './integration-ui';
import { SettingsCard, SettingsPage } from './primitives';
import { RuntimePairingPage } from './RuntimePairingPage';
import {
  consumeRuntimeShareRequest,
  runtimeShareRequest,
} from './runtimeSettingsState';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/** Settings UI for choosing and configuring the available agent harnesses. */
export function Harness(
  props: { onBack?: () => void; backLabel?: string } = {}
) {
  const canUseCodex = useCodexAgentsAccess();
  const [cursorApiKey, setCursorApiKey] = createSignal('');
  const cursorStatus = useCursorApiKeyStatusQuery();
  const saveCursorApiKey = useSaveCursorApiKey();
  const disconnectCursor = useDisconnectCursorApiKey();
  const cursorRegistered = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const harnessesQuery = useHarnessesQuery();
  const isTeamOwner = useIsTeamOwner();
  const deleteHarnessMutation = useDeleteHarnessMutation();
  const [pairingDialog, setPairingDialog] = createSignal<
    | {
        initialCode?: string;
      }
    | undefined
  >(undefined);
  const closePairing = () => {
    setPairingDialog(undefined);
  };
  const [removingHarness, setRemovingHarness] =
    createSignal<RegisteredHarness>();
  const [renamingHarness, setRenamingHarness] =
    createSignal<RegisteredHarness>();
  const [searchParams, setSearchParams] = useSearchParams();

  // The runtime the page points out, and the one whose Share menu is open.
  const [highlight, setHighlight] = createSignal<{ target: string }>();
  const [sharing, setSharing] = createSignal<string>();
  // Opened from an access-request notification: point out that runtime and,
  // for a request, open its Share menu, where the request waits.
  createEffect(
    on(runtimeShareRequest, (request) => {
      if (!request) return;
      setHighlight({ target: `runtime-${request.harnessId}` });
      if (request.share) setSharing(request.harnessId);
      consumeRuntimeShareRequest(request.id);
    })
  );

  onMount(() => {
    const pair = searchParams.pair;
    if (typeof pair === 'string' && pair.length > 0) {
      setPairingDialog({ initialCode: pair });
      setSearchParams({ pair: undefined }, { replace: true });
    }
  });

  const removeHarness = async () => {
    const current = removingHarness();
    if (!current) return;

    try {
      await deleteHarnessMutation.mutateAsync({ harnessId: current.id });
      setRemovingHarness(undefined);
      toast.success('Runtime removed');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to remove runtime'));
    }
  };

  const handleSaveCursorApiKey = async () => {
    const apiKey = cursorApiKey().trim();
    if (!isCursorApiKey(apiKey)) {
      toast.failure(CURSOR_KEY_FORMAT_ERROR);
      return;
    }

    try {
      await saveCursorApiKey.mutateAsync(apiKey);
      setCursorApiKey('');
      toast.success('Cursor connected');
    } catch (error) {
      toast.failure(
        failureMessage(error, 'Failed to save your Cursor API key')
      );
    }
  };

  const handleDisconnectCursor = async () => {
    if (disconnectCursor.isPending) return;
    const confirmed = await confirmDialog({
      title: 'Disconnect Cursor?',
      body: "Remove your Cursor connection from Macro? This removes Macro's copy of the API key but does not revoke it in Cursor.",
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!confirmed || disconnectCursor.isPending) return;
    try {
      await disconnectCursor.mutateAsync();
      setCursorApiKey('');
      toast.success('Cursor disconnected');
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to disconnect Cursor'));
    }
  };

  return (
    <>
      <Show when={!pairingDialog()}>
        <SettingsSearchTarget result={highlight()}>
          <SettingsPage
            title="Runtimes"
            description="Providers and machines your agents can run on."
            signpost={
              <TutorialPill tutorial="macrod" class="mt-1 self-start" />
            }
            onBack={props.onBack}
            backLabel={props.backLabel ?? 'Agents'}
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPairingDialog({})}
              >
                <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
                New runtime
              </Button>
            }
          >
            <ConnectedRuntimesSection
              harnesses={
                harnessesQuery.isSuccess
                  ? harnessesQuery.data.filter(
                      (harness) => harness.access === 'owner'
                    )
                  : []
              }
              error={harnessesQuery.isError}
              onRename={setRenamingHarness}
              onRemove={setRemovingHarness}
              sharing={sharing()}
              onSharingChange={setSharing}
            />
            <TeammateRuntimesSection
              canRemoveShared={isTeamOwner()}
              onRemove={setRemovingHarness}
            />
            <LocalRuntimeCard />
            <div>
              <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
                Built-in runtimes
              </h2>
              <SettingsCard>
                <section class="flex gap-4 px-6 py-5">
                  <HarnessIcon>
                    <HardDrivesIcon />
                  </HarnessIcon>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-h-5 items-start justify-between gap-3">
                      <h2 class="min-w-0 text-sm/5 font-medium text-ink">
                        {MACRO_HARNESS_NAME}
                      </h2>
                      <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                        Built in
                      </span>
                    </div>
                    <p class="mt-1 text-sm text-ink-muted">
                      Macro in house fast and powerful agent. Uses official
                      Macro tools and MCPs to get the job done.
                    </p>
                  </div>
                </section>

                <section class="flex gap-4 px-6 py-5">
                  <HarnessIcon>
                    <CursorIcon />
                  </HarnessIcon>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-h-5 items-start justify-between gap-3">
                      <h2 class="min-w-0 text-sm/5 font-medium text-ink">
                        Cursor
                      </h2>
                      <Show when={cursorRegistered()}>
                        <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
                          Connected
                        </span>
                      </Show>
                    </div>
                    <p class="mt-1 text-sm text-ink-muted">
                      Bring your own Cursor subscription to Macro. Manage Cursor
                      Cloud sessions directly in the app.
                    </p>

                    <Show
                      when={
                        cursorStatus.isSuccess &&
                        !cursorStatus.isPlaceholderData
                      }
                      fallback={
                        <p class="mt-4 text-xs text-ink-muted">
                          {cursorStatus.isError
                            ? 'Could not load your Cursor connection. Try refreshing this page.'
                            : 'Loading…'}
                        </p>
                      }
                    >
                      <Show
                        when={cursorRegistered()}
                        fallback={
                          <div class="mt-4 flex flex-col gap-1.5">
                            <label
                              for="cursor-harness-api-key"
                              class="text-xs text-ink"
                            >
                              API key
                            </label>
                            <div class="flex items-center gap-2 mobile:flex-col mobile:items-stretch">
                              <ApiKeyInput
                                id="cursor-harness-api-key"
                                class="flex-1"
                                size="sm"
                                prefix={CURSOR_KEY_PREFIX}
                                value={cursorApiKey()}
                                onValueChange={setCursorApiKey}
                                onSubmit={() =>
                                  fireAndForget(
                                    handleSaveCursorApiKey(),
                                    'cursor-connect'
                                  )
                                }
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={
                                  cursorApiKey().trim().length === 0 ||
                                  saveCursorApiKey.isPending
                                }
                                onClick={handleSaveCursorApiKey}
                              >
                                Save
                              </Button>
                            </div>
                            <p class="text-xs text-ink-extra-muted">
                              Create an API key in Cursor and paste it here.
                              Macro stores it encrypted.
                            </p>
                          </div>
                        }
                      >
                        <div class="mt-4 flex flex-col gap-3">
                          <div class="flex w-full max-w-60 flex-col gap-1.5">
                            <span class="text-xs font-medium text-ink">
                              Default model
                            </span>
                            <CursorDefaultModel />
                          </div>
                          <p class="text-xs text-ink-extra-muted">
                            The model new `@cursor` sessions start on.
                            Recommended models stay up top; everything else is
                            behind More models.
                          </p>
                        </div>

                        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <p class="flex-1 basis-56 text-xs text-ink-extra-muted">
                            Disconnecting removes Macro's copy of the key but
                            does not revoke it in Cursor.
                          </p>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            class="shrink-0"
                            disabled={disconnectCursor.isPending}
                            onClick={handleDisconnectCursor}
                          >
                            Disconnect
                          </Button>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </section>

                <Show when={canUseCodex()}>
                  <CodexHarness />
                </Show>
              </SettingsCard>
            </div>
          </SettingsPage>
        </SettingsSearchTarget>
      </Show>

      <Show when={pairingDialog()} keyed>
        {(dialog) => (
          <RuntimePairingPage
            initialCode={dialog.initialCode}
            onClose={closePairing}
          />
        )}
      </Show>
      <Show when={renamingHarness()} keyed>
        {(harness) => (
          <HarnessRenameDialog
            harness={harness}
            onClose={() => setRenamingHarness(undefined)}
          />
        )}
      </Show>
      <Show when={removingHarness()} keyed>
        {(harness) => (
          <HarnessRemoveDialog
            harnessName={harness.name}
            pending={deleteHarnessMutation.isPending}
            onClose={() => setRemovingHarness(undefined)}
            onConfirm={() => fireAndForget(removeHarness(), 'harness-settings')}
          />
        )}
      </Show>
    </>
  );
}

function HarnessRenameDialog(props: {
  harness: RegisteredHarness;
  onClose: () => void;
}) {
  const patchHarness = usePatchHarnessMutation();
  const [name, setName] = createSignal(props.harness.name);
  const canSave = () =>
    !patchHarness.isPending &&
    name().trim().length > 0 &&
    name().trim() !== props.harness.name;

  const save = async () => {
    if (!canSave()) return;
    try {
      await patchHarness.mutateAsync({
        harnessId: props.harness.id,
        name: name().trim(),
      });
      props.onClose();
    } catch (error) {
      toast.failure(failureMessage(error, 'Failed to rename runtime'));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) =>
        !open && !patchHarness.isPending && props.onClose()
      }
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Rename runtime
          </Dialog.Title>
        </Panel.Header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            fireAndForget(save(), 'harness-settings');
          }}
        >
          <Panel.Body class="flex flex-col gap-1.5 p-5">
            <label for="harness-rename" class="text-xs font-medium text-ink">
              Name
            </label>
            <Input
              id="harness-rename"
              size="sm"
              autofocus
              maxLength={100}
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </Panel.Body>
          <Panel.Footer class="justify-end gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={patchHarness.isPending}
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={!canSave()}
            >
              {patchHarness.isPending ? 'Saving…' : 'Save'}
            </Button>
          </Panel.Footer>
        </form>
      </Panel>
    </Dialog>
  );
}

function HarnessRemoveDialog(props: {
  harnessName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="px-5 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Remove {props.harnessName}?
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Dialog.Description class="text-sm leading-5 text-ink-muted">
            Agents using this runtime will stop running until it's reconnected.
            macrod on that machine will need to pair again.
          </Dialog.Description>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.pending ? 'Removing…' : 'Remove runtime'}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
