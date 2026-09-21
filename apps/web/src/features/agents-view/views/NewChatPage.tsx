import { promptActionOf } from '@app/features/block-agent/component/prompt-action';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { uploadFile } from '@core/util/upload';
import type { PromptAttachment } from '@service-agent-harness/generated/schemas';
import { createMemo, createSignal } from 'solid-js';
import { ChatComposer } from '../components/ChatComposer';
import type { AgentKind } from '../core/agent-kind';
import { defaultBranchFor } from '../core/repository';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { createReachableRepositories } from '../queries/reachable-repositories';
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
};

/** One agent choice determines the session kind, default model, and repository context. */
export function NewChatPage(props: {
  draft?: string;
  onDraftChange?: (draft: string) => void;
  autoFocus?: boolean;
  registerFocus?: (focus: () => void) => void;
  roster: RosterAgent[];
  rosterLoading: boolean;
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
}) {
  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const options = () => props.roster;
  const [agentId, setAgentId] = createSignal<string>();
  const [modelOverride, setModelOverride] = createSignal<string>();
  // A new conversation starts on Automatic until the caller picks a repository.
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>();
  const [localDraft, setLocalDraft] = createSignal('');
  const draft = () => props.draft ?? localDraft();
  const setDraft = (text: string) =>
    props.onDraftChange ? props.onDraftChange(text) : setLocalDraft(text);
  const [branchOverride, setBranchOverride] = createSignal<string>();
  const selected = createMemo(() => {
    const wanted =
      agentId() ??
      recentAgents
        .ids()
        .find((id) =>
          options().some((agent) => agent.id === id && !agent.unavailableReason)
        ) ??
      MACRO_PERSONA_ID;
    return options().find((agent) => agent.id === wanted) ?? options()[0];
  });
  const coding = () => selected()?.kind === 'coder';
  // The create-session API accepts explicit repositories only for Cursor.
  const canSelectRepository = () => selected()?.harness === 'cursor';
  const blocked = () => {
    const agent = selected();
    return agent ? agent.unavailableReason : 'Choose an agent to start';
  };
  // Listed only while the drawer can show them: chat agents never ask.
  const reachable = createReachableRepositories(coding);
  // A chosen branch, or where the selected repository's own clones start.
  const repoBranch = () =>
    branchOverride() ?? defaultBranchFor(reachable.repositories(), repoUrl());
  const selectRepository = (url: string | undefined) => {
    // Another repository starts on its own default branch, not the last one's.
    if (url !== repoUrl()) setBranchOverride(undefined);
    setRepoUrl(url);
    if (url) repositories.remember(url);
  };

  const connect = (agent: RosterAgent) => {
    if (agent.harness === 'cursor') openSettings('Harness');
  };

  const attachmentTracker = createInputAttachmentTracker();
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
    props.onStart({
      prompt,
      ...(attachments.length > 0
        ? { attachments: promptActionOf(prompt, attachments).attachments }
        : {}),
      botId: persona.botId,
      repoUrl: repo,
      ...(repo ? { repoBranch: repoBranch() } : {}),
      ...(modelOverride() ? { modelOverride: modelOverride() } : {}),
    });
    attachmentTracker.clearAttachments();
    setModelOverride(undefined);
  };

  const agentSelector = () => (
    <AgentPicker
      agents={options()}
      selected={selected()}
      modelOverride={modelOverride()}
      loading={props.rosterLoading}
      onSelect={(agent, model) => {
        setAgentId(agent.id);
        setModelOverride(model);
      }}
      onConnect={connect}
      onCreate={() => props.onOpenRoster(coding() ? 'coder' : 'agent')}
    />
  );

  return (
    <section class="page newchat" data-active aria-label="New conversation">
      <div class="col">
        <div class="greeting">
          <h2>
            {coding() ? 'What should we build?' : 'What should we work on?'}
          </h2>
        </div>
        <ChatComposer
          autoFocus={props.autoFocus}
          registerFocus={props.registerFocus}
          draft={draft()}
          onDraftChange={setDraft}
          blockedReason={blocked()}
          selector={agentSelector()}
          drawer={
            <RepositoryPicker
              repoUrl={repoUrl()}
              branch={repoBranch()}
              repositories={reachable.repositories()}
              repositoriesLoading={reachable.loading()}
              repositoriesError={reachable.error()}
              recentRepositories={repositories.urls()}
              onRetryRepositories={reachable.retry}
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
      </div>
    </section>
  );
}
