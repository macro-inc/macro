import { promptActionOf } from '@app/features/block-agent/component/prompt-action';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { uploadFile } from '@core/util/upload';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import type { PromptAttachment } from '@service-agent-harness/generated/schemas';
import { tourTarget } from '@ui/components/Tour';
import { createMemo, createSignal, Show } from 'solid-js';
import {
  type EffortChoice,
  effortConfigOption,
  effortLabel,
} from '../../block-agent/state/session-config';
import { ChatComposer } from '../components/ChatComposer';
import type { AgentKind } from '../core/agent-kind';
import { defaultBranchFor } from '../core/repository';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import {
  createPersistedComposerDraft,
  NEW_CONVERSATION_ATTACHMENTS_KEY,
} from '../primitives/composer-draft';
import { createPreferredInmemModel } from '../primitives/preferred-inmem-model';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { createComposerModels } from '../queries/composer-models';
import { createReachableRepositories } from '../queries/reachable-repositories';
import { createRepositoryBranches } from '../queries/repository-branches';
import { AGENTS_TOUR } from '../tour';
import { AgentPicker } from './AgentPicker';
import { RepositoryPicker } from './RepositoryPicker';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
  attachments?: PromptAttachment[];
  /** Persisted or first-party bot to run; omitted for Macro's default. */
  botId?: string;
  repoUrl?: string;
  repoBranch?: string;
  modelOverride?: string;
  effortOverride?: { configId: string; value: string };
};

/** One agent choice determines the session kind, default model, and repository context. */
export function NewChatPage(props: {
  compact?: boolean;
  active?: boolean;
  workspaceId?: string;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  autoFocus?: boolean;
  registerFocus?: (focus: () => void) => void;
  roster: RosterAgent[];
  /** Offer only this kind; the Agents workspace passes its Work or Code mode. */
  kind?: AgentKind;
  rosterLoading: boolean;
  /** Agents are listed but whether they can start is still unknown. */
  availabilityLoading?: boolean;
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
}) {
  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const preferredInmem = createPreferredInmemModel(userId());
  const options = () => {
    const kind = props.kind;
    return kind
      ? props.roster.filter((agent) => agent.kind === kind)
      : props.roster;
  };
  const [agentId, setAgentId] = createSignal<string>();
  /** One-shot model from a coding agent's submenu; Macro uses {@link preferredInmem}. */
  const [modelOverride, setModelOverride] = createSignal<string>();
  const [repositoryPickerOpen, setRepositoryPickerOpen] = createSignal(false);
  // A new conversation starts on Automatic until the caller picks a repository.
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>();
  const persistedDraft = createPersistedComposerDraft();
  const draft = () => props.draft ?? persistedDraft.draft();
  const setDraft = (text: string) =>
    props.onDraftChange
      ? props.onDraftChange(text)
      : persistedDraft.setDraft(text);
  const [branchOverride, setBranchOverride] = createSignal<string>();
  const recentAgentId = () => {
    // Falling back to Macro before availability is known would open the
    // compact composer, then swap to the last agent's layout once it settles.
    const settling = props.rosterLoading || props.availabilityLoading;
    return recentAgents
      .ids()
      .find((id) =>
        options().some(
          (agent) => agent.id === id && (settling || !agent.unavailableReason)
        )
      );
  };
  const selected = createMemo(() => {
    for (const wanted of [agentId(), recentAgentId(), MACRO_PERSONA_ID]) {
      const agent = options().find((option) => option.id === wanted);
      if (agent) return agent;
    }
    return options().find((agent) => !agent.unavailableReason) ?? options()[0];
  });
  const selectedCatalog = createComposerModels(selected);
  /** In-memory choices come from the owner's catalog; other runtimes keep their rules. */
  const composerModelOverride = () => {
    const agent = selected();
    if (agent?.harness !== 'macro-inmem' && agent?.harness !== 'in-memory')
      return modelOverride();
    const preferred =
      modelOverride() ??
      (agent.id === MACRO_PERSONA_ID
        ? preferredInmem.model()
        : agent.defaultModel);
    return selectedCatalog.models().some((option) => option.id === preferred)
      ? preferred
      : selectedCatalog.currentModel();
  };
  const capabilityTarget = () => {
    const agent = selected();
    const harness =
      agent?.harness === 'macro-inmem' ? 'in-memory' : agent?.harness;
    if (harness !== 'in-memory' && harness !== 'cursor') return undefined;
    return {
      harness,
      model:
        composerModelOverride() ??
        (harness === 'in-memory' ? undefined : agent?.defaultModel),
    } as const;
  };
  const capabilities = useAgentCapabilitiesQuery(capabilityTarget);
  const effort = () =>
    effortConfigOption(
      capabilities.isSuccess ? capabilities.data.configOptions : []
    );
  const [effortSelection, setEffortSelection] = createSignal<{
    target: string;
    configId: string;
    value: string;
    name: string;
  }>();
  const selectedEffort = () => {
    const selection = effortSelection();
    return selection?.target === JSON.stringify(capabilityTarget())
      ? selection
      : undefined;
  };
  // The submenu already validated this choice. Retain it while the selected
  // model's discovery refreshes; startup revalidates against the runtime.
  const effortOverride = () => {
    const selection = selectedEffort();
    return selection
      ? { configId: selection.configId, value: selection.value }
      : undefined;
  };
  const coding = () => (props.kind ?? selected()?.kind) === 'coder';
  const localRuntime = () => selected()?.harness === 'macrod';
  const canSelectRepository = () =>
    selected()?.harness === 'cursor' || localRuntime();
  const blocked = () => {
    const agent = selected();
    return agent ? agent.unavailableReason : 'Choose an agent to start';
  };
  // Listed only while the drawer can show them: chat agents never ask.
  const reachable = createReachableRepositories(coding);
  // Listed only while a repository is chosen: listing costs a GitHub call.
  const reachableBranches = createRepositoryBranches(() =>
    coding() && !localRuntime() ? repoUrl() : undefined
  );
  // A chosen branch, or where the selected repository's own clones start.
  const repoBranch = () =>
    localRuntime()
      ? 'main'
      : (branchOverride() ??
        defaultBranchFor(reachable.repositories(), repoUrl()));
  const selectRepository = (url: string | undefined) => {
    // Another repository starts on its own default branch, not the last one's.
    if (url !== repoUrl()) setBranchOverride(undefined);
    setRepoUrl(url);
    if (url) repositories.remember(url);
  };

  const connect = (agent: RosterAgent) => {
    if (agent.harness === 'cursor') openSettings('Harness');
  };

  const attachmentTracker = createInputAttachmentTracker({
    // Home supplies its own text draft; attachment persistence here is for Agents.
    persistenceKey: props.onDraftChange
      ? undefined
      : NEW_CONVERSATION_ATTACHMENTS_KEY,
  });
  const attachFiles = (files: File[]) =>
    void uploadInputAttachments({
      files,
      tracker: attachmentTracker,
      uploadFile: (file) =>
        uploadFile(file, 'static', { hideProgressIndicator: true }),
    });

  const send = (prompt: string, attachments: InputAttachmentData[]) => {
    const persona = selected();
    if (
      (!prompt.trim() && attachments.length === 0) ||
      !persona ||
      blocked() ||
      attachmentTracker.hasPending()
    )
      return;
    recentAgents.remember(persona.id);
    const repo = canSelectRepository() ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    const model = composerModelOverride();
    props.onStart({
      prompt,
      ...(attachments.length > 0
        ? { attachments: promptActionOf(prompt, attachments).attachments }
        : {}),
      botId: persona.botId,
      repoUrl: repo,
      ...(repo ? { repoBranch: repoBranch() } : {}),
      ...(model ? { modelOverride: model } : {}),
      effortOverride: effortOverride(),
    });
    attachmentTracker.clearAttachments();
    // Macro's preferred model stays; coding-agent submenu picks are one-shot.
    setModelOverride(undefined);
    setEffortSelection(undefined);
  };

  const selectAgent = (
    agent: RosterAgent,
    model?: string,
    selection?: EffortChoice
  ) => {
    setAgentId(agent.id);
    if (agent.id === MACRO_PERSONA_ID) {
      if (model) preferredInmem.remember(model);
      // Still set the override so the trigger updates when Macro was
      // already selected (agent id unchanged would otherwise skip a render).
      setModelOverride(model);
    } else {
      setModelOverride(model);
    }
    setEffortSelection(
      selection
        ? { ...selection, target: JSON.stringify(capabilityTarget()) }
        : undefined
    );
  };

  const agentSelector = () => (
    <AgentPicker
      agents={options()}
      selected={selected()}
      modelOverride={composerModelOverride()}
      loading={props.rosterLoading}
      effortLabel={selectedEffort()?.name ?? effortLabel(effort())}
      effortSelection={effortOverride()}
      onSelect={selectAgent}
      onSelectEffort={selectAgent}
      onConnect={connect}
      onCreate={() => props.onOpenRoster(coding() ? 'coder' : 'agent')}
    />
  );

  const composer = () => (
    <ChatComposer
      autoFocus={props.autoFocus}
      collapseOnBlur={props.compact}
      controlsOpen={repositoryPickerOpen()}
      registerFocus={props.registerFocus}
      draft={draft()}
      onDraftChange={setDraft}
      blockedReason={blocked()}
      selector={agentSelector()}
      drawer={
        <RepositoryPicker
          onOpenChange={setRepositoryPickerOpen}
          repoUrl={repoUrl()}
          branch={repoBranch()}
          branchLocked={localRuntime()}
          repositories={reachable.repositories()}
          repositoriesLoading={reachable.loading()}
          repositoriesError={reachable.error()}
          recentRepositories={repositories.urls()}
          onRetryRepositories={reachable.retry}
          branches={reachableBranches.branches()}
          branchesLoading={reachableBranches.loading()}
          branchesError={reachableBranches.error()}
          onRetryBranches={reachableBranches.retry}
          onConnectGitHub={() => openSettings('Connected')}
          onSelectRepository={selectRepository}
          onSelectBranch={setBranchOverride}
        />
      }
      drawerOpen={coding()}
      placeholder={coding() ? 'Describe what you want to build' : undefined}
      onSend={send}
      attachments={attachmentTracker.attachments()}
      onAttachFiles={attachFiles}
      onRemoveAttachment={(attachment) =>
        attachmentTracker.removeAttachment(attachment.id)
      }
    />
  );

  return (
    <Show when={!props.compact} fallback={composer()}>
      <section class="page newchat" data-active aria-label="New conversation">
        <div ref={tourTarget(AGENTS_TOUR.composer)} class="col">
          <div class="greeting">
            <h2>
              {coding() ? 'What should we build?' : 'What should we work on?'}
            </h2>
          </div>
          <FloatRegionOrInline
            region="accessory"
            active={() => props.active !== false}
          >
            <div
              data-agent-new-composer={props.workspaceId}
              class="agents-view-portal touch:px-(--mobile-chrome-gutter) pointer-events-auto min-w-0"
            >
              {composer()}
            </div>
          </FloatRegionOrInline>
        </div>
      </section>
    </Show>
  );
}
