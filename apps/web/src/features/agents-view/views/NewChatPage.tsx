import { promptActionOf } from '@app/features/block-agent/component/prompt-action';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { SpeedToggle } from '@core/component/AI/component/input/SpeedToggle';
import { modelLabel } from '@core/component/AI/constant/model-label';
import {
  acceleratedSpeed,
  speedForModel,
} from '@core/component/AI/constant/speed';
import { fastModeEnabled } from '@core/component/AI/signal/speed';
import { ComposerGreeting } from '@core/component/ComposerGreeting';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { uploadFile } from '@core/util/upload';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import AutoIcon from '@icon/system/regular/sparkle.svg';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import { chooseAgentMode } from '@queries/agents/mode-choice';
import { useAiBillingSummaryQuery } from '@queries/auth/ai-billing';
import type { PromptAttachment } from '@service-agent-harness/generated/schemas';
import { Tabs } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createMemo, createSignal, Show } from 'solid-js';
import { EffortSelector } from '../../block-agent/component/EffortSelector';
import {
  type EffortChoice,
  effortConfigOption,
  effortLabel,
} from '../../block-agent/state/session-config';
import { ChatComposer } from '../components/ChatComposer';
import { type AgentKind, kindForMode } from '../core/agent-kind';
import {
  type AgentsMode,
  agentsModeLabel,
  type ComposerMode,
} from '../core/mode';
import { defaultBranchFor } from '../core/repository';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import {
  createPersistedComposerDraft,
  NEW_CONVERSATION_ATTACHMENTS_KEY,
} from '../primitives/composer-draft';
import { createPreferredInmemModel } from '../primitives/preferred-inmem-model';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { createWorkspaceMode } from '../primitives/workspace-mode';
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
  /** The catalog was still loading, so an in-memory agent runs its persona default. */
  modelFallback?: boolean;
  effortOverride?: { configId: string; value: string };
  speedOverride?: { configId: string; value: string };
  onDelivered?: () => void;
  onFailure?: () => void;
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
  /**
   * Auto, Chat, or Code; Chat and Code also limit the agents offered.
   * Uncontrolled callers start in Auto.
   */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  rosterLoading: boolean;
  /** Agents are listed but whether they can start is still unknown. */
  availabilityLoading?: boolean;
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
}) {
  const userId = useUserId();
  const billing = useAiBillingSummaryQuery();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const preferredInmem = createPreferredInmemModel(userId());
  const ownMode = createWorkspaceMode();
  const mode = () => props.mode ?? ownMode.mode();
  const auto = () => mode() === 'auto';
  /** Auto shows and prepares the chat agent; a prompt it sends to Code starts the coding agent. */
  const agentsMode = (): AgentsMode => (mode() === 'code' ? 'code' : 'chat');
  const optionsFor = (kind: AgentsMode) =>
    props.roster.filter((agent) => agent.kind === kindForMode(kind));
  const options = () => optionsFor(agentsMode());
  const [agentId, setAgentId] = createSignal<string>();
  /** One-shot model from a coding agent's submenu; Macro uses {@link preferredInmem}. */
  const [modelOverride, setModelOverride] = createSignal<string>();
  const [effortPickerOpen, setEffortPickerOpen] = createSignal(false);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = createSignal(false);
  // A new conversation starts on Automatic until the caller picks a repository.
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>();
  const persistedDraft = createPersistedComposerDraft(undefined, userId);
  const draft = () => props.draft ?? persistedDraft.draft();
  const setDraft = (text: string) =>
    props.onDraftChange
      ? props.onDraftChange(text)
      : persistedDraft.setDraft(text);
  const [branchOverride, setBranchOverride] = createSignal<string>();
  /** The picked agent, else the last one used, else Macro, else any that can start. */
  const preferredAgent = (kind: AgentsMode, picked?: string) => {
    const options = optionsFor(kind);
    // Falling back to Macro before availability is known would open the
    // compact composer, then swap to the last agent's layout once it settles.
    const settling = props.rosterLoading || props.availabilityLoading;
    const recent = recentAgents
      .ids()
      .find((id) =>
        options.some(
          (agent) => agent.id === id && (settling || !agent.unavailableReason)
        )
      );
    for (const wanted of [picked, recent, MACRO_PERSONA_ID]) {
      const agent = options.find((option) => option.id === wanted);
      if (agent) return agent;
    }
    return options.find((agent) => !agent.unavailableReason) ?? options[0];
  };
  const selected = createMemo(() => preferredAgent(agentsMode(), agentId()));
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
    const config = effort();
    const minimum =
      billing.isSuccess &&
      (billing.data.tier === 'free' || billing.data.tier === 'premium')
        ? config?.options[0]
        : undefined;
    const selection =
      selectedEffort() ??
      (minimum && config
        ? { configId: config.id, value: minimum.value, name: minimum.name }
        : undefined);
    return selection
      ? { configId: selection.configId, value: selection.value }
      : undefined;
  };
  const coding = () => mode() === 'code';
  // Auto holds the send while the backend picks Chat or Code.
  const [choosingMode, setChoosingMode] = createSignal(false);
  const localRuntime = () => selected()?.harness === 'macrod';
  const canSelectRepository = () =>
    selected()?.harness === 'cursor' || localRuntime();
  const blocked = () => {
    if (choosingMode()) return 'Choosing Chat or Code…';
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
    // Both land on Settings → Runtimes: Cursor to save an API key, macrod to
    // restart the local runtime (one click on desktop) or re-pair it.
    if (agent.harness === 'cursor' || agent.harness === 'macrod') {
      openSettings('Harness');
    }
  };

  const attachmentTracker = createMemo(() => {
    const identity = userId();
    return createInputAttachmentTracker({
      // Home owns its attachments; unknown identities never read shared storage.
      persistenceKey:
        !props.onDraftChange && identity
          ? `${NEW_CONVERSATION_ATTACHMENTS_KEY}:${encodeURIComponent(identity)}`
          : undefined,
    });
  });
  const attachFiles = (files: File[]) =>
    fireAndForget(
      uploadInputAttachments({
        files,
        tracker: attachmentTracker(),
        uploadFile: (file) =>
          uploadFile(file, 'static', { hideProgressIndicator: true }),
      }),
      'agents-view'
    );

  const send = (prompt: string, attachments: InputAttachmentData[]) => {
    if (
      (!prompt.trim() && attachments.length === 0) ||
      !selected() ||
      blocked() ||
      attachmentTracker().hasPending()
    )
      return;
    if (auto()) fireAndForget(sendAuto(prompt, attachments), 'agents-view');
    else start(prompt, attachments);
  };

  /** Starts the user's usual coding agent when the prompt needs one, else the chat agent. */
  const sendAuto = async (
    prompt: string,
    attachments: InputAttachmentData[]
  ) => {
    const coder = preferredAgent('code');
    if (!prompt.trim() || !coder || coder.unavailableReason) {
      start(prompt, attachments);
      return;
    }
    const submittedUserId = userId();
    setChoosingMode(true);
    const chosen = await chooseAgentMode(prompt);
    setChoosingMode(false);
    // A different account signed in meanwhile; this prompt was not theirs.
    if (userId() !== submittedUserId) return;
    start(prompt, attachments, chosen === 'code' ? coder : undefined);
  };

  /**
   * Starts the selected agent with the composer's model, effort, speed, and
   * repository, or Auto's `coder` with its own defaults.
   */
  const start = (
    prompt: string,
    attachments: InputAttachmentData[],
    coder?: RosterAgent
  ) => {
    const persona = coder ?? selected();
    if (!persona) return;
    recentAgents.remember(persona.id);
    const repo = !coder && canSelectRepository() ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    const model = coder ? undefined : composerModelOverride();
    const inMemory =
      persona.harness === 'macro-inmem' || persona.harness === 'in-memory';
    const submittedTracker = attachmentTracker();
    const submittedUserId = userId();
    props.onStart({
      prompt,
      onFailure: () => {
        if (userId() === submittedUserId && !draft()) setDraft(prompt);
      },
      ...(attachments.length > 0
        ? {
            attachments: promptActionOf(prompt, attachments).attachments,
            onDelivered: () => {
              const tracker =
                userId() === submittedUserId
                  ? attachmentTracker()
                  : submittedTracker;
              for (const attachment of attachments) {
                tracker.removeAttachment(attachment.id);
              }
            },
          }
        : {}),
      botId: persona.botId,
      repoUrl: repo,
      ...(repo ? { repoBranch: repoBranch() } : {}),
      ...(model ? { modelOverride: model } : {}),
      ...(inMemory && !model && (coder || selectedCatalog.pending())
        ? { modelFallback: true }
        : {}),
      effortOverride: coder ? undefined : effortOverride(),
      ...(model && inMemory && acceleratedSpeed(model)
        ? {
            speedOverride: {
              configId: 'speed',
              value: speedForModel(model, fastModeEnabled()),
            },
          }
        : {}),
    });
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

  let focusInput: (() => void) | undefined;
  const restoreInputFocus = (event: Event) => {
    event.preventDefault();
    focusInput?.();
  };
  const agentSelector = () => (
    <AgentPicker
      agents={options()}
      selected={selected()}
      modelOverride={composerModelOverride()}
      loading={props.rosterLoading}
      effortLabel={
        selectedEffort()?.name ?? effortLabel(effort(), effortOverride()?.value)
      }
      effortSelection={effortOverride()}
      onCloseAutoFocus={restoreInputFocus}
      onSelect={selectAgent}
      onSelectEffort={selectAgent}
      onConnect={connect}
      onCreate={() => props.onOpenRoster(coding() ? 'coder' : 'agent')}
    />
  );

  const setMode = (next: ComposerMode) => {
    // A model or effort picked for the other mode's agent does not carry over.
    setModelOverride(undefined);
    setEffortSelection(undefined);
    if (props.onModeChange) props.onModeChange(next);
    else ownMode.setMode(next);
  };

  const modeSwitch = () => (
    <div ref={tourTarget(AGENTS_TOUR.modeSwitch)} class="shrink-0">
      <Tabs
        aria-label="Conversation mode"
        options={[
          ...(ownMode.autoAvailable()
            ? [
                {
                  value: 'auto' as const,
                  label: agentsModeLabel('auto'),
                  icon: AutoIcon,
                },
              ]
            : []),
          { value: 'chat', label: agentsModeLabel('chat'), icon: ChatIcon },
          { value: 'code', label: agentsModeLabel('code'), icon: CodeIcon },
        ]}
        variant="track"
        fullWidth
        // Phones keep the icons; the name stays for assistive tech.
        iconOnly={isTouchDevice()}
        value={mode()}
        onChange={setMode}
        class={ownMode.autoAvailable() ? 'w-72 touch:w-36' : 'w-56 touch:w-24'}
      />
    </div>
  );

  const repositoryPicker = () => (
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
  );

  const composer = () => (
    <ChatComposer
      autoFocus={props.autoFocus}
      collapseOnBlur={props.compact}
      controlsOpen={repositoryPickerOpen() || effortPickerOpen()}
      registerFocus={(focus) => {
        focusInput = focus;
        props.registerFocus?.(focus);
      }}
      draft={draft()}
      onDraftChange={setDraft}
      blockedReason={blocked()}
      selector={
        // Auto picks the agent per prompt, so it has no agent, model, or effort to choose.
        <div class="flex min-w-0 items-center gap-1" hidden={auto()}>
          {agentSelector()}
          <EffortSelector
            onCloseAutoFocus={restoreInputFocus}
            onOpenChange={setEffortPickerOpen}
            config={effort()}
            value={effortOverride()?.value}
            disabled={Boolean(blocked())}
            onChange={(choice) =>
              setEffortSelection({
                ...choice,
                target: JSON.stringify(capabilityTarget()),
              })
            }
          />
          <Show
            when={['macro-inmem', 'in-memory'].includes(
              selected()?.harness ?? ''
            )}
          >
            <SpeedToggle model={composerModelOverride() ?? ''} />
          </Show>
        </div>
      }
      drawer={
        <div class="flex w-full min-w-0 items-center gap-2">
          {modeSwitch()}
          <Show when={coding()}>
            <div class="min-w-0 flex-1 touch:[&>div]:justify-end">
              {repositoryPicker()}
            </div>
          </Show>
        </div>
      }
      drawerOpen
      placeholder={coding() ? 'Describe what you want to build' : undefined}
      onSend={send}
      modelName={modelLabel(
        composerModelOverride(),
        selectedCatalog
          .models()
          .find((model) => model.id === composerModelOverride())?.name
      )}
      supportsImages={
        selectedCatalog
          .models()
          .find((model) => model.id === composerModelOverride())?.supportsImages
      }
      attachments={attachmentTracker().attachments()}
      onAttachFiles={attachFiles}
      onRemoveAttachment={(attachment) =>
        attachmentTracker().removeAttachment(attachment.id)
      }
    />
  );

  return (
    <Show when={!props.compact} fallback={composer()}>
      <section class="page newchat" data-active aria-label="New conversation">
        <div ref={tourTarget(AGENTS_TOUR.composer)} class="col">
          <div class="greeting">
            <ComposerGreeting wireframe={coding()}>
              <Show when={mode()} keyed>
                {(currentMode) => (
                  <span class="greeting-text">
                    {currentMode === 'code'
                      ? 'What should we build?'
                      : 'What should we work on?'}
                  </span>
                )}
              </Show>
            </ComposerGreeting>
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
