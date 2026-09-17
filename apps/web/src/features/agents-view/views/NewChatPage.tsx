import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import CaretDownIcon from '@phosphor/caret-down.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ChatComposer } from '../components/ChatComposer';
import { MenuAnchor, MenuGroup, MenuOption } from '../components/Menu';
import type { AgentKind } from '../core/agent-kind';
import { parseRepositoryInput, repositoryLabel } from '../core/repository';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForComposer,
} from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { AgentPicker } from './AgentPicker';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
  /** Persisted or first-party bot to run; omitted for Macro's default. */
  botId?: string;
  repoUrl?: string;
  modelOverride?: string;
};

/** One agent choice determines the session kind, default model, and repository context. */
export function NewChatPage(props: {
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
  const options = createMemo(() => rosterForComposer(props.roster));
  const [agentId, setAgentId] = createSignal<string>();
  const [modelOverride, setModelOverride] = createSignal<string>();
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>(
    repositories.urls()[0]
  );
  const [draft, setDraft] = createSignal('');
  const [repoInput, setRepoInput] = createSignal('');
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
    const repo = coding() ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    props.onStart({
      prompt,
      botId: persona.botId,
      repoUrl: repo,
      ...(modelOverride() ? { modelOverride: modelOverride() } : {}),
    });
    setModelOverride(undefined);
  };

  const addRepository = () => {
    const url = parseRepositoryInput(repoInput());
    if (!url) return;
    repositories.remember(url);
    setRepoUrl(url);
    setRepoInput('');
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

  const repositorySelector = () => (
    <MenuAnchor
      menuLabel="Repository"
      trigger={(menu) => (
        <button
          type="button"
          class={repoUrl() ? 'pill' : 'pill empty'}
          aria-haspopup="listbox"
          aria-expanded={menu.open()}
          title="Repository (optional)"
          onClick={(event) => {
            event.stopPropagation();
            menu.toggle();
          }}
        >
          <span class="logo">
            <GithubIcon class="ph" style={{ width: '16px', height: '16px' }} />
          </span>
          <span class="lbl truncate">
            <Show when={repoUrl()} fallback="Add repository">
              {(url) => (
                <span class="mono" style={{ 'font-size': '12px' }}>
                  {repositoryLabel(url())}
                </span>
              )}
            </Show>
          </span>
          <CaretDownIcon class="ph caret" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div class="filter">
            <PlusIcon class="ph" />
            <input
              placeholder="Add owner/repo or a URL"
              aria-label="Add repository"
              value={repoInput()}
              onInput={(event) => setRepoInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addRepository();
                close();
              }}
            />
          </div>
          <MenuOption
            checked={!repoUrl()}
            onSelect={() => {
              setRepoUrl(undefined);
              close();
            }}
          >
            <XIcon class="ph" />
            <span class="nm">No repository</span>
            <span class="sub">workspace only</span>
          </MenuOption>
          <Show when={repositories.urls().length > 0}>
            <MenuGroup>Recent</MenuGroup>
            <For each={repositories.urls()}>
              {(url) => (
                <MenuOption
                  checked={repoUrl() === url}
                  onSelect={() => {
                    setRepoUrl(url);
                    close();
                  }}
                >
                  <GithubIcon class="ph" />
                  <span class="nm">{repositoryLabel(url)}</span>
                </MenuOption>
              )}
            </For>
          </Show>
          <div class="foot">
            <span>Optional · repository for this session</span>
            <span>{repositories.urls().length} repos</span>
          </div>
        </>
      )}
    </MenuAnchor>
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
          draft={draft()}
          onDraftChange={setDraft}
          blockedReason={blocked()}
          selector={agentSelector()}
          drawer={repositorySelector()}
          drawerOpen={coding()}
          placeholder={coding() ? 'Describe what you want to build' : undefined}
          onSend={send}
        />
      </div>
    </section>
  );
}
