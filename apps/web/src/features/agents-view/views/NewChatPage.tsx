import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { createMemo, createSignal } from 'solid-js';
import { ChatComposer } from '../components/ChatComposer';
import type { AgentKind } from '../core/agent-kind';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { AgentPicker } from './AgentPicker';
import { RepositoryPicker } from './RepositoryPicker';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
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
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>(
    repositories.urls()[0]
  );
  const [localDraft, setLocalDraft] = createSignal('');
  const draft = () => props.draft ?? localDraft();
  const setDraft = (text: string) =>
    props.onDraftChange ? props.onDraftChange(text) : setLocalDraft(text);
  const [repoBranch, setRepoBranch] = createSignal('main');
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

  const connect = (agent: RosterAgent) => {
    if (agent.harness === 'cursor') openSettings('Harness');
  };

  const send = (prompt: string) => {
    const persona = selected();
    if (!prompt.trim() || !persona || blocked()) return;
    recentAgents.remember(persona.id);
    const repo = canSelectRepository() ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    props.onStart({
      prompt,
      botId: persona.botId,
      repoUrl: repo,
      ...(repo ? { repoBranch: repoBranch() } : {}),
      ...(modelOverride() ? { modelOverride: modelOverride() } : {}),
    });
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
              recentRepositories={repositories.urls()}
              onSelect={(url, branch) => {
                setRepoUrl(url);
                setRepoBranch(branch);
                if (url) repositories.remember(url);
              }}
            />
          }
          drawerOpen={coding()}
          placeholder={coding() ? 'Describe what you want to build' : undefined}
          onSend={send}
        />
      </div>
    </section>
  );
}
