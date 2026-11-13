import { promptActionOf } from '@app/features/block-agent/component/prompt-action';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { requestRuntimeAccess } from '@app/features/runtime-sharing/core/request-access';
import { LocalRuntimePrompt } from '@app/features/settings/components/local-runtime-prompt';
import { t } from '@app/lib/i18n';
import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { SpeedSelector } from '@core/component/AI/component/input/SpeedSelector';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { nativeSpeeds, resolveSpeed } from '@core/component/AI/constant/speed';
import {
  preferredSpeed,
  setPreferredSpeed,
} from '@core/component/AI/signal/speed';
import { chatAttachmentMentionToMarkdown } from '@core/component/AI/util/chatAttachmentMention';
import { ComposerGreeting } from '@core/component/ComposerGreeting';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { uploadFile } from '@core/util/upload';
import type { AgentSessionEntity } from '@entity';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import AutoIcon from '@icon/system/regular/sparkle.svg';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import { chooseAgentMode } from '@queries/agents/mode-choice';
import { useAiBillingSummaryQuery } from '@queries/auth/ai-billing';
import type { PromptAttachment } from '@service-agent-harness/generated/schemas';
import { Tabs } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { AgentUpdatesStack } from '../../agent-updates/views/AgentUpdatesStack';
import { EffortSelector } from '../../block-agent/component/EffortSelector';
import {
  type EffortChoice,
  effortConfigOption,
  effortLabel,
  selectConfigOption,
} from '../../block-agent/state/session-config';
import { ChatComposer } from '../components/ChatComposer';
import { type AgentKind, kindForMode } from '../core/agent-kind';
import {
  type AgentsMode,
  agentsModeLabel,
  type ComposerMode,
} from '../core/mode';
import { defaultBranchFor, sameRepository } from '../core/repository';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import {
  createPersistedComposerDraft,
  NEW_CONVERSATION_ATTACHMENTS_KEY,
} from '../primitives/composer-draft';
import { createPreferredEffort } from '../primitives/preferred-effort';
import { createPreferredInmemModel } from '../primitives/preferred-inmem-model';
import { createPreferredRepository } from '../primitives/preferred-repository';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { createWorkspaceMode } from '../primitives/workspace-mode';
import { createComposerModels } from '../queries/composer-models';
import { createReachableRepositories } from '../queries/reachable-repositories';
import { createRepositoryBranches } from '../queries/repository-branches';
import { AGENTS_TOUR } from '../tour';
import { AgentPicker } from './AgentPicker';
import { RepositoryPicker } from './RepositoryPicker';

/** Another surface asking the composer to select an agent. */
export type AgentRequest = { agentId: string; request: string };

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
  /** Override the New conversation attachment store. Home uses its own key. */
  attachmentsKey?: string;
  autoFocus?: boolean;
  registerFocus?: (focus: () => void) => void;
  roster: RosterAgent[];
  /**
   * Auto, Chat, or Code; Chat and Code also limit the agents offered.
   * Uncontrolled callers start in Auto.
   */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  /**
   * An agent to select, e.g. one just set up on a Macro computer. Each
   * request selects it again, also after the user picked another; one not in
   * the roster yet is selected once it arrives.
   */
  requestedAgent?: AgentRequest;
  rosterLoading: boolean;
  /** Agents are listed but whether they can start is still unknown. */
  availabilityLoading?: boolean;
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
  updateSessions?: readonly AgentSessionEntity[];
  onOpenUpdateSession?: (sessionId: string) => void;
  showUpdates?: boolean;
  /** Centered under the composer, such as the Agents tutorial pill. */
  belowComposer?: JSX.Element;
}) {
  const userId = useUserId();
  const billing = useAiBillingSummaryQuery();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const preferredInmem = createPreferredInmemModel(userId());
  const preferredEffort = createPreferredEffort(userId());
  const ownMode = createWorkspaceMode();
  const mode = () => props.mode ?? ownMode.mode();
  const auto = () => mode() === 'auto';
  /** Auto shows and prepares the chat agent; a prompt it sends to Code starts the coding agent. */
  const agentsMode = (): AgentsMode => (mode() === 'code' ? 'code' : 'chat');
  const optionsFor = (kind: AgentsMode) =>
    props.roster.filter((agent) => agent.kind === kindForMode(kind));
  const options = () => optionsFor(agentsMode());
  const [agentId, setAgentId] = createSignal<string>();
  createEffect(
    on(
      () => props.requestedAgent,
      (requested) => {
        if (requested) setAgentId(requested.agentId);
      }
    )
  );
  /** One-shot model from a coding agent's submenu; Macro uses {@link preferredInmem}. */
  const [modelOverride, setModelOverride] = createSignal<string>();
  const [effortPickerOpen, setEffortPickerOpen] = createSignal(false);
  const [speedPickerOpen, setSpeedPickerOpen] = createSignal(false);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = createSignal(false);
  const preferredRepository = createPreferredRepository(userId());
  // An explicit Auto-detect pick must override a saved repository, too.
  const [repositoryOverride, setRepositoryOverride] = createSignal<{
    url?: string;
  }>();
  const persistedDraft = createPersistedComposerDraft(undefined, userId);
  const draft = () => props.draft ?? persistedDraft.draft();
  const setDraft = (text: string) =>
    props.onDraftChange
      ? props.onDraftChange(text)
      : persistedDraft.setDraft(text);
  const [branchOverride, setBranchOverride] = createSignal<{
    repository: string;
    branch: string;
  }>();
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
  /** The selected model's tier option, when Macro's agent offers more than standard. */
  const speedOption = () => {
    if (capabilityTarget()?.harness !== 'in-memory') return;
    const option = selectConfigOption(
      capabilities.isSuccess ? capabilities.data.configOptions : [],
      'speed',
      'speed'
    );
    const offered = nativeSpeeds(
      option?.options.map((choice) => choice.value) ?? []
    );
    return option && offered ? { option, offered } : undefined;
  };
  const speedOverride = () => {
    const tiers = speedOption();
    if (!tiers) return;
    return {
      configId: tiers.option.id,
      value: resolveSpeed(preferredSpeed(), tiers.offered),
    };
  };
  /** The last effort picked for the selected runtime and model, while it is still offered. */
  const selectedEffort = () => {
    const target = capabilityTarget();
    if (!target) return;
    const choice = preferredEffort.effort(JSON.stringify(target));
    const config = effort();
    // Retain it while the selected model's discovery refreshes; startup
    // revalidates against the runtime.
    if (!choice || !config) return choice;
    return config.id === choice.configId &&
      config.options.some((option) => option.value === choice.value)
      ? choice
      : undefined;
  };
  const rememberEffort = (choice: EffortChoice) => {
    const target = capabilityTarget();
    if (target) preferredEffort.remember(JSON.stringify(target), choice);
  };
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
    if (!agent) return 'Choose an agent to start';
    if (agent.unavailableReason) return agent.unavailableReason;
    // A paid tier would otherwise be dropped silently while the model's
    // options are still loading.
    if (
      capabilityTarget()?.harness === 'in-memory' &&
      capabilities.isPending &&
      preferredSpeed() !== 'standard'
    ) {
      return t('agentControls.loadingTiers');
    }
    if (canSelectRepository() && repoUrl()) {
      if (reachable.loading()) return 'Loading repositories';
      if (reachable.error()) return 'Retry loading repositories before sending';
    }
    return undefined;
  };
  // Listed only while the drawer can show them: chat agents never ask.
  const reachable = createReachableRepositories(coding);
  const repoUrl = () => {
    const override = repositoryOverride();
    if (override) return override.url;
    const preferred = preferredRepository.repository();
    if (!preferred) return undefined;
    // Keep the saved label while loading; never submit a stale default.
    if (reachable.loading() || reachable.error()) return preferred;
    return reachable
      .repositories()
      .find((repo) => sameRepository(repo.url, preferred))?.url;
  };
  // Listed only while a repository is chosen: listing costs a GitHub call.
  const reachableBranches = createRepositoryBranches(() =>
    coding() && !localRuntime() ? repoUrl() : undefined
  );
  // A chosen branch, or where the selected repository's own clones start.
  const repoBranch = () => {
    if (localRuntime()) return 'main';
    const override = branchOverride();
    return override && override.repository === repoUrl()
      ? override.branch
      : defaultBranchFor(reachable.repositories(), repoUrl());
  };
  const selectBranch = (branch: string) => {
    const repository = repoUrl();
    if (repository) setBranchOverride({ repository, branch });
  };
  const selectRepository = (url: string | undefined) => {
    // Another repository starts on its own default branch, not the last one's.
    if (url !== repoUrl()) setBranchOverride(undefined);
    setRepositoryOverride({ url });
    if (url) repositories.remember(url);
  };

  const connect = (agent: RosterAgent) => {
    if (agent.needsRuntimeAccess && agent.harnessId) {
      fireAndForget(
        requestRuntimeAccess(agent.harnessId),
        'runtime-sharing.request'
      );
      return;
    }
    // Both land on Settings → Runtimes: Cursor to save an API key, macrod to
    // restart the local runtime (one click on desktop) or re-pair it.
    if (agent.harness === 'cursor' || agent.harness === 'macrod') {
      openSettings('Harness');
    }
  };

  const attachmentTracker = createMemo(() => {
    const identity = userId();
    const key = props.attachmentsKey ?? NEW_CONVERSATION_ATTACHMENTS_KEY;
    return createInputAttachmentTracker({
      // Unknown identities never read shared storage. Parents may own the
      // text draft without owning files; those still persist here.
      persistenceKey: identity
        ? `${key}:${encodeURIComponent(identity)}`
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
      ...(inMemory && speedOverride()
        ? { speedOverride: speedOverride() }
        : {}),
    });
    // Macro's preferred model and the picked efforts stay; coding-agent model
    // picks are one-shot.
    setModelOverride(undefined);
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
    if (selection) rememberEffort(selection);
  };

  let focusInput: (() => void) | undefined;
  const chatAboutUpdate = (sessionId: string, sessionName: string) => {
    const mention = chatAttachmentMentionToMarkdown({
      documentId: sessionId,
      documentName: sessionName,
      blockName: 'agent',
    });
    setDraft(
      `${draft().trim()}${draft().trim() ? '\n\n' : ''}${mention}\nAbout this update: `
    );
    focusInput?.();
  };
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
    // A model picked for the other mode's agent does not carry over.
    setModelOverride(undefined);
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
      onSelectBranch={selectBranch}
    />
  );

  const composer = () => (
    <ChatComposer
      autoFocus={props.autoFocus}
      collapseOnBlur={props.compact}
      controlsOpen={
        repositoryPickerOpen() || effortPickerOpen() || speedPickerOpen()
      }
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
            onChange={rememberEffort}
          />
          <SpeedSelector
            onCloseAutoFocus={restoreInputFocus}
            onOpenChange={setSpeedPickerOpen}
            offered={speedOption()?.option.options ?? []}
            value={speedOverride()?.value ?? 'standard'}
            disabled={Boolean(blocked())}
            onChange={setPreferredSpeed}
          />
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
              <LocalRuntimePrompt />
              {composer()}
            </div>
          </FloatRegionOrInline>
          {props.belowComposer}
          <Show
            when={
              props.showUpdates &&
              props.updateSessions &&
              props.onOpenUpdateSession
            }
          >
            <AgentUpdatesStack
              home
              sessions={props.updateSessions ?? []}
              onOpenSession={(id) => props.onOpenUpdateSession?.(id)}
              onChatAbout={chatAboutUpdate}
            />
          </Show>
        </div>
      </section>
    </Show>
  );
}
