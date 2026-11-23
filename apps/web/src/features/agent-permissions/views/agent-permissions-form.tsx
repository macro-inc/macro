import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { queryReadyGate } from '@queries/gate';
import type {
  AgentToolPermissions,
  ToolPermissionChange,
} from '@service-agent-harness/generated/schemas';
import { Button, ConfirmDialog, cn, Tabs } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { FollowingNote, sourceMention } from '../components/following-note';
import { PermissionsSkeleton } from '../components/permissions-skeleton';
import { PolicySourceCard } from '../components/policy-source-card';
import { PolicySourcePicker } from '../components/policy-source-picker';
import { ToolPermissions } from '../components/tool-permissions';
import {
  applyChanges,
  blankView,
  defaultCandidate,
  latestChanges,
} from '../core/references';
import {
  useAgentToolPermissionsQuery,
  useToolPermissionCatalogQuery,
} from '../queries/permissions';
import {
  detachNow,
  setSourceNow,
  useDetachMutation,
  usePolicyViewQuery,
  useSetSourceMutation,
  useSourceCandidatesQuery,
} from '../queries/references';
import type { SourceCandidate } from '../queries/references-view';
import { AgentPermissionsPanel } from './agent-permissions-panel';
import { refusalMessage } from './permission-changes';

type Mode = 'source' | 'own';

/** What the new-agent form saves once the agent exists. */
export type PermissionsDraft = {
  mode: Mode;
  /** The policy picked to follow, or the default when none was picked. */
  sourcePolicyId?: string;
  /** What a new agent of this scope follows unless told otherwise. */
  defaultPolicyId?: string;
  /** The own permissions' changes over the source's, when `mode` is `own`. */
  changes: ToolPermissionChange[];
};

/**
 * Saves a new agent's permissions: follows the picked policy when it isn't
 * the scope's default, then, for own permissions, copies what it follows
 * and applies the draft's changes. The agent already exists, so a failure
 * leaves it following its default, which is safe.
 */
export async function applyPermissionsDraft(
  agentId: string,
  draft: PermissionsDraft
) {
  const interaction = beginInteraction(
    draft.mode === 'own'
      ? 'agent_permissions.detach'
      : 'agent_permissions.set_source'
  );
  const sourcePolicyId = draft.sourcePolicyId;
  const result = await ResultAsync.fromPromise(
    (async () => {
      if (sourcePolicyId && sourcePolicyId !== draft.defaultPolicyId) {
        await setSourceNow({
          agentId,
          sourcePolicyId,
          trace: interaction.span,
        });
      }
      if (draft.mode === 'own') {
        await detachNow({
          agentId,
          changes: latestChanges(draft.changes),
          trace: interaction.span,
        });
      }
    })(),
    (error) => error
  );
  interaction.end();
  return result;
}

function ModeTabs(props: {
  value: Mode;
  disabled?: boolean;
  onChange: (mode: Mode) => void;
}) {
  return (
    <Tabs
      aria-label={t('agentPermissions.permissionMode')}
      options={[
        { value: 'source', label: t('agentPermissions.useAnotherAgents') },
        { value: 'own', label: t('agentPermissions.setMyOwn') },
      ]}
      value={props.value}
      disabled={props.disabled}
      size="sm"
      touch="segmented"
      onChange={props.onChange}
    />
  );
}

/** "Show @macro's permissions": what the source resolves to, read-only, collapsed. */
function InheritedPreview(props: { mention: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="flex flex-col gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="self-start"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {open()
          ? t('agentPermissions.hideSourcePermissions', {
              source: props.mention,
            })
          : t('agentPermissions.showSourcePermissions', {
              source: props.mention,
            })}
        <CaretDownIcon
          class={cn(
            'size-3 shrink-0 pointer-events-none transition-transform',
            open() && 'rotate-180'
          )}
        />
      </Button>
      <Show when={open()}>{props.children}</Show>
    </div>
  );
}

const NOTHING_PENDING = () => undefined;

/**
 * The new-agent form's Permissions: follow another agent's (preselected:
 * personal Macro for a private agent, the team default for a team one), or
 * set its own, starting from what the picked agent resolves to. Nothing is
 * saved until the agent exists; `draft` hands the form a reader for what
 * to save (`applyPermissionsDraft`).
 */
export function NewAgentPermissions(props: {
  share: 'Private' | 'Team';
  teamId?: string;
  draft: (read: () => PermissionsDraft) => void;
}) {
  const [mode, setMode] = createSignal<Mode>('source');
  const [picked, setPicked] = createSignal<string>();
  const [changes, setChanges] = createSignal<ToolPermissionChange[]>([]);

  const catalogQuery = useToolPermissionCatalogQuery();
  const candidatesQuery = useSourceCandidatesQuery(() => ({
    scope: props.share === 'Private' ? 'private' : 'team',
    teamId: props.share === 'Team' ? props.teamId : undefined,
  }));
  const candidates = (): SourceCandidate[] =>
    queryReadyGate(candidatesQuery) ? (candidatesQuery.data ?? []) : [];
  const fallback = () => defaultCandidate(candidates(), props.share);
  // A pick from the other scope (Who can use it changed) no longer applies.
  const selected = () =>
    candidates().find((candidate) => candidate.policyId === picked()) ??
    fallback();

  const sourceView = usePolicyViewQuery(() => selected()?.policyId);
  const catalog = () =>
    queryReadyGate(catalogQuery) ? catalogQuery.data : undefined;
  // Own permissions start from what the picked agent resolves to.
  const prefill = (): AgentToolPermissions | undefined => {
    const current = catalog();
    if (!current) return undefined;
    if (!selected()) return blankView(current);
    if (!queryReadyGate(sourceView)) return undefined;
    return sourceView.data ?? blankView(current);
  };
  const ownView = () => {
    const base = prefill();
    return base && applyChanges(base, changes());
  };

  props.draft(() => ({
    mode: mode(),
    sourcePolicyId: selected()?.policyId,
    defaultPolicyId: fallback()?.policyId,
    changes: changes(),
  }));

  const available = () => catalogQuery.data !== null;

  return (
    <Show when={available()}>
      <div class="flex flex-col gap-3">
        <ModeTabs value={mode()} onChange={setMode} />
        <Switch>
          <Match when={mode() === 'source'}>
            <Show
              when={selected()}
              fallback={
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge-muted px-4.5 py-3.5 text-sm text-ink-muted">
                  {t('agentPermissions.noSourcePicked')}
                  <PolicySourcePicker
                    candidates={candidates()}
                    onPick={(candidate) => setPicked(candidate.policyId)}
                  />
                </div>
              }
            >
              {(source) => (
                <>
                  <p class="text-sm text-ink-muted">
                    {t('agentPermissions.followsChanges', {
                      source: sourceMention(source()),
                    })}
                  </p>
                  <PolicySourceCard
                    kind={source().kind}
                    agent={source().agent}
                    team={source().team}
                    scope={source().scope}
                    title={t('agentPermissions.useSamePermissionsAs')}
                    action={
                      <PolicySourcePicker
                        candidates={candidates()}
                        selected={source().policyId}
                        onPick={(candidate) => setPicked(candidate.policyId)}
                      />
                    }
                  />
                  <Show when={catalog()}>
                    {(current) => (
                      <InheritedPreview mention={sourceMention(source())}>
                        <Show
                          when={queryReadyGate(sourceView) && sourceView.data}
                          fallback={<PermissionsSkeleton />}
                        >
                          {(view) => (
                            <ToolPermissions
                              catalog={current()}
                              view={view()}
                              editable={false}
                              pendingState={NOTHING_PENDING}
                              onChange={() => {}}
                            />
                          )}
                        </Show>
                      </InheritedPreview>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </Match>
          <Match when={mode() === 'own'}>
            <p class="text-sm text-ink-muted">
              {t('agentPermissions.ownDescription')}
            </p>
            <Show
              when={catalog() !== undefined && ownView()}
              fallback={<PermissionsSkeleton />}
            >
              {(view) => (
                <Show when={catalog()}>
                  {(current) => (
                    <ToolPermissions
                      catalog={current()}
                      view={view()}
                      editable
                      pendingState={NOTHING_PENDING}
                      onChange={(change) =>
                        setChanges((list) => [...list, change])
                      }
                    />
                  )}
                </Show>
              )}
            </Show>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

/**
 * An existing agent's Permissions in its editor: what it follows (Set agent
 * changes it, after confirming when it had its own permissions) or its own
 * permissions (Use my own permissions copies what it follows and stops
 * following). Changes save at once.
 */
export function EditAgentPermissions(props: {
  agentId: string;
  agentName: string;
}) {
  const viewQuery = useAgentToolPermissionsQuery(() => props.agentId);
  const candidatesQuery = useSourceCandidatesQuery(() => ({
    agentId: props.agentId,
  }));
  const setSource = useSetSourceMutation(() => props.agentId);
  const detach = useDetachMutation(() => props.agentId);
  // A tab picked without acting yet; otherwise the tab says what is saved.
  const [tab, setTab] = createSignal<Mode>();
  const [confirming, setConfirming] = createSignal<SourceCandidate>();

  const view = () =>
    queryReadyGate(viewQuery) ? (viewQuery.data ?? undefined) : undefined;
  const following = () => Boolean(view()?.source);
  const mode = (): Mode => tab() ?? (following() ? 'source' : 'own');
  const canSetSource = () => view()?.canSetSource ?? false;
  const candidates = (): SourceCandidate[] =>
    queryReadyGate(candidatesQuery) ? (candidatesQuery.data ?? []) : [];

  const confirmingMention = () => {
    const candidate = confirming();
    return candidate ? sourceMention(candidate) : '';
  };

  const follow = async (candidate: SourceCandidate) => {
    const interaction = beginInteraction('agent_permissions.set_source');
    const result = await ResultAsync.fromPromise(
      setSource.mutateAsync({
        agentId: props.agentId,
        sourcePolicyId: candidate.policyId,
        trace: interaction.span,
      }),
      (error) => error
    );
    interaction.end();
    setConfirming(undefined);
    if (result.isErr()) {
      toast.failure(t('agentPermissions.setSourceFailed'), {
        subtext: refusalMessage(result.error),
      });
      return;
    }
    setTab(undefined);
  };

  // Following another policy replaces own settings, so ask first.
  const pick = (candidate: SourceCandidate) => {
    if (following()) fireAndForget(follow(candidate), 'agent-permissions');
    else setConfirming(candidate);
  };

  const useOwn = async () => {
    const interaction = beginInteraction('agent_permissions.detach');
    const result = await ResultAsync.fromPromise(
      detach.mutateAsync({ agentId: props.agentId, trace: interaction.span }),
      (error) => error
    );
    interaction.end();
    if (result.isErr()) {
      toast.failure(t('agentPermissions.detachFailed'), {
        subtext: refusalMessage(result.error),
      });
      return;
    }
    setTab(undefined);
  };

  return (
    <div class="flex flex-col gap-3">
      <Show when={view()}>
        <ModeTabs value={mode()} disabled={!canSetSource()} onChange={setTab} />
      </Show>
      <Switch>
        <Match when={mode() === 'source' && view()?.source}>
          {(source) => (
            <>
              <FollowingNote
                source={source()}
                title={t('agentPermissions.useSamePermissionsAs')}
                action={
                  <Show when={canSetSource()}>
                    <PolicySourcePicker
                      candidates={candidates()}
                      selected={source().policyId ?? undefined}
                      disabled={setSource.isPending}
                      onPick={pick}
                    />
                  </Show>
                }
              />
              <InheritedPreview mention={sourceMention(source())}>
                <AgentPermissionsPanel
                  agentId={props.agentId}
                  agentName={props.agentName}
                  hideSource
                />
              </InheritedPreview>
            </>
          )}
        </Match>
        <Match when={mode() === 'source'}>
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge-muted px-4.5 py-3.5 text-sm text-ink-muted">
            {t('agentPermissions.pickSource')}
            <PolicySourcePicker
              candidates={candidates()}
              disabled={setSource.isPending}
              onPick={pick}
            />
          </div>
        </Match>
        <Match when={mode() === 'own' && following()}>
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge-muted px-4.5 py-3.5">
            <p class="min-w-0 flex-1 basis-56 text-sm text-ink-muted">
              {t('agentPermissions.useOwnExplained')}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={detach.isPending}
              onClick={() => fireAndForget(useOwn(), 'agent-permissions')}
            >
              {t('agentPermissions.useMyOwn')}
            </Button>
          </div>
        </Match>
        <Match when={mode() === 'own'}>
          <AgentPermissionsPanel
            agentId={props.agentId}
            agentName={props.agentName}
          />
        </Match>
      </Switch>
      <ConfirmDialog
        open={confirming() !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={t('agentPermissions.followTitle', {
          source: confirmingMention(),
        })}
        confirmLabel={t('agentPermissions.followConfirm')}
        cancelLabel={t('agentPermissions.cancel')}
        pending={setSource.isPending}
        onConfirm={() => {
          const candidate = confirming();
          if (candidate) fireAndForget(follow(candidate), 'agent-permissions');
        }}
        body={
          <p>{t('agentPermissions.followBody', { agent: props.agentName })}</p>
        }
      />
    </div>
  );
}
