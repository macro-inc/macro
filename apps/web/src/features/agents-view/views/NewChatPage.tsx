import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import CodeIcon from '@phosphor/code.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AgentIcon } from '../components/AgentGlyph';
import { ChatComposer } from '../components/ChatComposer';
import { ComposerModeSwitch } from '../components/ComposerModeSwitch';
import { MenuAnchor, MenuGroup, MenuOption } from '../components/Menu';
import { type ModelChoice, ModelSelector } from '../components/ModelSelector';
import type { AgentKind } from '../core/agent-kind';
import type { AgentsMode } from '../core/mode';
import { parseRepositoryInput, repositoryLabel } from '../core/repository';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForMode,
} from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';
import { createComposerModels } from '../queries/composer-models';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
  /** Persisted or first-party bot to run; omitted for Macro's default. */
  botId?: string;
  modelOverride?: string;
  repoUrl?: string;
};

/** One composer with mode-specific agents, drafts, models, and repository context. */
export function NewChatPage(props: {
  mode: AgentsMode;
  onModeChange: (mode: AgentsMode) => void;
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
  const options = createMemo(() => rosterForMode(props.roster, props.mode));
  const [chatAgentId, setChatAgentId] = createSignal(MACRO_PERSONA_ID);
  const [coderId, setCoderId] = createSignal<string>();
  const [chatModelOverride, setChatModelOverride] = createSignal<string>();
  const [codeModelOverride, setCodeModelOverride] = createSignal<string>();
  const modelOverride = () =>
    props.mode === 'chat' ? chatModelOverride() : codeModelOverride();
  const setModelOverride = (model: string | undefined) => {
    if (props.mode === 'chat') setChatModelOverride(model);
    else setCodeModelOverride(model);
  };
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>(
    repositories.urls()[0]
  );
  const [chatDraft, setChatDraft] = createSignal('');
  const [codeDraft, setCodeDraft] = createSignal('');
  const [repoInput, setRepoInput] = createSignal('');

  // Code leads with the coder used most recently that can still be started;
  // Cursor is the default coding runtime.
  const defaultCoderId = () =>
    recentAgents
      .ids()
      .find((id) =>
        options().some((agent) => agent.id === id && !agent.unavailableReason)
      ) ??
    options().find((agent) => !agent.unavailableReason)?.id ??
    CURSOR_BOT_ID;
  const selected = createMemo(() => {
    const wanted =
      props.mode === 'code' ? (coderId() ?? defaultCoderId()) : chatAgentId();
    return options().find((agent) => agent.id === wanted) ?? options()[0];
  });
  const blocked = () => {
    const agent = selected();
    return agent ? agent.unavailableReason : 'Choose an agent to start';
  };

  const pick = (id: string) => {
    if (props.mode === 'code') setCoderId(id);
    else setChatAgentId(id);
    setModelOverride(undefined);
  };
  const connect = (agent: RosterAgent) => {
    if (agent.harness === 'cursor') openSettings('Harness');
  };

  const modelCatalog = createComposerModels(selected);
  const models = (): ModelChoice[] =>
    modelCatalog.models().map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const defaultModel = () =>
    selected()?.defaultModel ?? modelCatalog.currentModel();
  const modelName = (id: string | undefined) =>
    id ? (models().find((model) => model.id === id)?.name ?? id) : 'default';
  const currentModelId = () => modelOverride() ?? defaultModel();
  const send = (prompt: string) => {
    const persona = selected();
    if (!prompt.trim() || !persona || blocked()) return;
    recentAgents.remember(persona.id);
    const repo = props.mode === 'code' ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    props.onStart({
      prompt,
      botId: persona.botId,
      modelOverride: modelOverride(),
      repoUrl: repo,
    });
  };

  const addRepository = () => {
    const url = parseRepositoryInput(repoInput());
    if (!url) return;
    repositories.remember(url);
    setRepoUrl(url);
    setRepoInput('');
  };

  const agentSelector = () => (
    <MenuAnchor
      menuLabel="Agent"
      trigger={(menu) => (
        <button
          type="button"
          class="pill"
          aria-haspopup="listbox"
          aria-expanded={menu.open()}
          title="Agent"
          aria-label="Agent"
          onClick={(event) => {
            event.stopPropagation();
            menu.toggle();
          }}
        >
          <span class="logo">
            <Show when={selected()}>
              {(agent) => <AgentIcon agent={agent()} class="ph" />}
            </Show>
          </span>
          <span class="lbl truncate">{selected()?.name}</span>
          <CaretDownIcon class="ph caret" />
        </button>
      )}
    >
      {(close) => (
        <>
          <For each={options().filter((agent) => agent.share === 'system')}>
            {(agent) => (
              <AgentOption
                agent={agent}
                checked={agent.id === selected()?.id}
                onSelect={() => {
                  if (agent.connectLabel) connect(agent);
                  else pick(agent.id);
                  close();
                }}
              />
            )}
          </For>
          <Show when={options().some((agent) => agent.share !== 'system')}>
            <MenuGroup>
              {props.mode === 'code' ? 'Your coding agents' : 'Your agents'}
            </MenuGroup>
            <For each={options().filter((agent) => agent.share !== 'system')}>
              {(agent) => (
                <AgentOption
                  agent={agent}
                  checked={agent.id === selected()?.id}
                  onSelect={() => {
                    if (agent.connectLabel) connect(agent);
                    else pick(agent.id);
                    close();
                  }}
                />
              )}
            </For>
          </Show>
          <Show when={props.rosterLoading}>
            <div role="status" class="px-3 py-2 text-xs text-ink-muted">
              Loading agents…
            </div>
          </Show>
          <div class="foot">
            <span class="cnt">
              {options().length} {options().length === 1 ? 'agent' : 'agents'}
            </span>
            <button
              type="button"
              class="cta sm"
              onClick={() => {
                close();
                props.onOpenRoster(props.mode === 'code' ? 'coder' : 'agent');
              }}
            >
              <PlusIcon class="ph" />
              {props.mode === 'code' ? 'Create coding agent' : 'Create agent'}
            </button>
          </div>
        </>
      )}
    </MenuAnchor>
  );

  const modelSelector = () => (
    <Show when={selected()}>
      <ModelSelector
        model={currentModelId()}
        options={models()}
        emptyMessage={modelCatalog.message()}
        onSelect={setModelOverride}
        label={
          <Show when={currentModelId()} fallback="Select model">
            {(model) => (
              <Show
                when={modelOverride()}
                fallback={
                  <>
                    <span class="k">default</span> ({modelName(model())})
                  </>
                }
              >
                {modelName(model())}
              </Show>
            )}
          </Show>
        }
      >
        <Dropdown.Group>
          <Show
            when={!selected()?.connectLabel}
            fallback={
              <Dropdown.Item
                closeOnSelect
                onSelect={() => {
                  const agent = selected();
                  if (agent) connect(agent);
                }}
              >
                {selected()?.connectLabel}
              </Dropdown.Item>
            }
          >
            <Dropdown.Item
              closeOnSelect
              onSelect={() => setModelOverride(undefined)}
            >
              <ProviderIcon model={defaultModel()} class="size-4" />
              <span class="min-w-0 flex-1 truncate">Agent default</span>
              <Show when={!modelOverride()}>
                <CheckIcon class="size-3.5 shrink-0 text-accent" />
              </Show>
            </Dropdown.Item>
          </Show>
        </Dropdown.Group>
      </ModelSelector>
    </Show>
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
            {props.mode === 'code'
              ? 'What should we build?'
              : 'What should we work on?'}
          </h2>
        </div>
        <ChatComposer
          draftKey={props.mode}
          draft={props.mode === 'code' ? codeDraft() : chatDraft()}
          onDraftChange={(draft) =>
            props.mode === 'code' ? setCodeDraft(draft) : setChatDraft(draft)
          }
          blockedReason={blocked()}
          modeSelector={
            <ComposerModeSwitch
              mode={props.mode}
              onChange={props.onModeChange}
            />
          }
          agentSelector={agentSelector()}
          modelSelector={modelSelector()}
          drawer={repositorySelector()}
          drawerOpen={props.mode === 'code'}
          placeholder={
            props.mode === 'code'
              ? 'Describe what you want to build'
              : undefined
          }
          onSend={send}
        />
      </div>
    </section>
  );
}

function AgentOption(props: {
  agent: RosterAgent;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <MenuOption
      checked={props.checked}
      disabled={!!props.agent.unavailableReason && !props.agent.connectLabel}
      onSelect={props.onSelect}
    >
      <span class="logo">
        <AgentIcon agent={props.agent} class="ph" />
      </span>
      <span class="nm">{props.agent.name}</span>
      <span class="hint">
        {props.agent.connectLabel ?? `@${props.agent.handle}`}
      </span>
      <Show when={props.agent.kind === 'coder'}>
        <span class="badge coder" title="Coding agent">
          <CodeIcon class="ph" />
        </span>
      </Show>
      <Show when={props.agent.share === 'system'}>
        <span class="badge system sysb">system</span>
      </Show>
    </MenuOption>
  );
}
