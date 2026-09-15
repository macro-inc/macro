import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { useSettingsState } from '@core/constant/SettingsState';
import { useAuthor, useUserId } from '@core/context/user';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import AtIcon from '@phosphor/at.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CodeIcon from '@phosphor/code.svg';
import GearIcon from '@phosphor/gear.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { useCursorModelsQuery } from '@queries/auth/cursor-api-key';
import { $getSelection, $isRangeSelection } from 'lexical';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AgentAvatar, AgentIcon } from '../components/AgentGlyph';
import { MenuAnchor, MenuGroup, MenuOption } from '../components/Menu';
import type { AgentKind } from '../core/agent-kind';
import { relativeAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import {
  type AgentConversationEntity,
  botUsage,
} from '../core/recent-conversations';
import { parseRepositoryInput, repositoryLabel } from '../core/repository';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForMode,
} from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
  /** Persisted or first-party bot to run; omitted for Macro's default. */
  botId?: string;
  modelOverride?: string;
  repoUrl?: string;
};

type ModelChoice = { id: string; name: string; provider: string };

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
  other: 'Other',
};

const IN_MEMORY_MODELS: ModelChoice[] = Object.values(Model).map((id) => ({
  id,
  name: MODEL_PRETTYNAME[id],
  provider: modelProvider(id) ?? 'other',
}));

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(author: string): string {
  return author.includes('@') ? author.split('@')[0] : author.split(' ')[0];
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The New chat / New session page: who you are talking to, and the composer
 * that starts the conversation. Chat picks the agent from a pill; Code picks
 * the coder from cards and can hand it a repository.
 */
export function NewChatPage(props: {
  mode: AgentsMode;
  roster: RosterAgent[];
  rosterLoading: boolean;
  /** The loaded conversations, for each coder's usage footer. */
  conversations: AgentConversationEntity[];
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
  /** Opens a saved coder in the editor. */
  onConfigure: (agent: RosterAgent) => void;
}) {
  const userId = useUserId();
  const author = useAuthor();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const options = createMemo(() => rosterForMode(props.roster, props.mode));
  const [chatAgentId, setChatAgentId] = createSignal(MACRO_PERSONA_ID);
  const [coderId, setCoderId] = createSignal<string>();
  const [modelOverride, setModelOverride] = createSignal<string>();
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>(
    repositories.urls()[0]
  );
  const [markdown, setMarkdown] = createSignal('');
  const [repoInput, setRepoInput] = createSignal('');
  const [modelFilter, setModelFilter] = createSignal('');

  // Code leads with the coder used most recently that can still be started;
  // Macro's sandboxed coder is the fallback.
  const defaultCoderId = () =>
    recentAgents
      .ids()
      .find((id) =>
        options().some((agent) => agent.id === id && !agent.unavailableReason)
      ) ??
    options().find((agent) => !agent.unavailableReason)?.id ??
    MACRO_CODER_BOT_ID;
  const selected = createMemo(() => {
    const wanted =
      props.mode === 'code' ? (coderId() ?? defaultCoderId()) : chatAgentId();
    return options().find((agent) => agent.id === wanted) ?? options()[0];
  });
  const blocked = () => selected()?.unavailableReason;

  const pick = (id: string) => {
    if (props.mode === 'code') setCoderId(id);
    else setChatAgentId(id);
    setModelOverride(undefined);
  };
  const connect = (agent: RosterAgent) => {
    if (agent.harness === 'cursor') openSettings('Harness');
  };

  const cursorConnected = () =>
    props.roster.find((agent) => agent.id === CURSOR_BOT_ID)?.runtime
      .connected ?? false;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const models = (): ModelChoice[] => {
    const persona = selected();
    if (!persona) return [];
    if (persona.harness === 'cursor') {
      return cursorModels.isSuccess
        ? cursorModels.data.models.map((model) => ({
            id: model.id,
            name: model.displayName,
            provider: modelProvider(model.id) ?? 'other',
          }))
        : [];
    }
    if (persona.harness === 'in-memory' || persona.harness === 'macro-inmem') {
      return IN_MEMORY_MODELS;
    }
    return [];
  };
  const modelName = (id: string | undefined) =>
    id ? (models().find((model) => model.id === id)?.name ?? id) : 'default';
  const currentModelId = () => modelOverride() ?? selected()?.defaultModel;
  const providers = () =>
    [...new Set(models().map((model) => model.provider))].toSorted();
  const filteredModels = (provider: string) =>
    models().filter((model) => {
      if (model.provider !== provider) return false;
      const query = modelFilter().trim().toLowerCase();
      return (
        !query ||
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query)
      );
    });

  const usage = createMemo(() => botUsage(props.conversations));
  const coders = () =>
    options().toSorted((left, right) => {
      const used = (agent: RosterAgent) =>
        agent.botId ? (usage().get(agent.botId)?.lastUsedAt ?? 0) : 0;
      return used(right) - used(left);
    });

  const editor = buildConfig('chat')
    .namespace('agents-view-composer')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSkills()
    .onEnter(() => {
      send();
      return true;
    })
    .onChange(setMarkdown);

  const canSend = () => markdown().trim().length > 0 && !blocked();

  const send = () => {
    const persona = selected();
    if (!canSend() || !persona) return;
    const prompt = markdown().trim();
    editor.controls.clear();
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

  const mention = () => {
    editor.controls.focus();
    editor.lexical.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText('@');
    });
  };

  const addRepository = () => {
    const url = parseRepositoryInput(repoInput());
    if (!url) return;
    repositories.remember(url);
    setRepoUrl(url);
    setRepoInput('');
  };

  const greeting = greetingForHour(new Date().getHours());
  const placeholder = () =>
    props.mode === 'code'
      ? `Task for @${selected()?.handle ?? 'coder'} · @mention context, / for skills`
      : `Message ${selected()?.name ?? 'Macro'} · @mention anything, / for skills`;

  return (
    <section class="page newchat" data-active aria-label="New chat">
      <div class="col">
        <div class="greeting">
          <p class="hello">
            {greeting}, {firstName(author())}
          </p>
          <h2>
            <Show
              when={props.mode === 'chat'}
              fallback={
                <>
                  What should <em>{selected()?.name ?? 'a coder'}</em> work on?
                </>
              }
            >
              <span class="mark">
                <Show when={selected()}>
                  {(agent) => <AgentIcon agent={agent()} />}
                </Show>
              </span>
              <span>
                What should <em>{selected()?.name ?? 'Macro'}</em> work on?
              </span>
            </Show>
          </h2>
          <p>Ask across your docs, mail, and channels. @mention anything.</p>
        </div>

        <div class="agents-strip" aria-label="Agents">
          <div class="head">
            <div style={{ display: 'flex', 'align-items': 'baseline' }}>
              <h3>Your coders</h3>
              <span class="hint">by last used</span>
            </div>
            <button
              type="button"
              class="cta"
              onClick={() => props.onOpenRoster('coder')}
            >
              <PlusIcon class="ph" />
              Create coder
            </button>
          </div>
          <div class="track" role="radiogroup" aria-label="Agent">
            <For each={coders()}>
              {(agent) => {
                const used = () =>
                  agent.botId ? usage().get(agent.botId) : undefined;
                return (
                  <button
                    type="button"
                    class="card"
                    role="radio"
                    aria-checked={agent.id === selected()?.id}
                    aria-disabled={
                      agent.unavailableReason && !agent.connectLabel
                        ? true
                        : undefined
                    }
                    title={agent.unavailableReason}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('.cfg')) return;
                      if (agent.connectLabel) return connect(agent);
                      if (agent.unavailableReason) return;
                      pick(agent.id);
                    }}
                  >
                    <Show when={agent.persisted}>
                      <span
                        class="cfg"
                        role="button"
                        tabIndex={0}
                        aria-label={`Configure ${agent.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onConfigure(agent);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onConfigure(agent);
                          }
                        }}
                      >
                        <GearIcon class="ph" />
                      </span>
                    </Show>
                    <span class="top">
                      <AgentAvatar agent={agent} coder />
                      <span class="truncate">
                        <div class="name">
                          <span class="truncate">{agent.name}</span>
                          <Show when={agent.share === 'system'}>
                            <span
                              class="badge system"
                              style={{ 'font-size': '9px', padding: '1px 6px' }}
                            >
                              system
                            </span>
                          </Show>
                        </div>
                        <div class="handle">@{agent.handle}</div>
                      </span>
                    </span>
                    <span class="runtime">
                      <span
                        class={agent.runtime.connected ? 'conn' : 'conn off'}
                      />
                      <span>{agent.runtime.label}</span>
                      <Show when={agent.defaultModel}>
                        {(model) => (
                          <>
                            <span class="sep">·</span>
                            <span class="mono truncate">{model()}</span>
                          </>
                        )}
                      </Show>
                    </span>
                    <span class="foot">
                      <span>
                        <Show
                          when={agent.connectLabel}
                          fallback={
                            <Show when={used()} fallback="Not used yet">
                              {(stats) => (
                                <>
                                  Last used{' '}
                                  <b>{relativeAge(stats().lastUsedAt)}</b>
                                </>
                              )}
                            </Show>
                          }
                        >
                          {(label) => <b>{label()}</b>}
                        </Show>
                      </span>
                      <span class="mono num">
                        {used()?.sessions ?? 0} sessions
                      </span>
                    </span>
                  </button>
                );
              }}
            </For>
            <Show when={props.rosterLoading && coders().length === 0}>
              <span class="hint" role="status">
                Loading coders…
              </span>
            </Show>
          </div>
        </div>

        <div class="menu-anchor composer-anchor">
          <div class="composer">
            <span class="sr">Message the agent</span>
            <div class="editor">
              <MarkdownShell
                config={editor}
                placeholder={placeholder()}
                autofocus
              />
            </div>
            <div class="bar">
              <MenuAnchor
                id="agentPillWrap"
                menuLabel="Agent"
                trigger={(menu) => (
                  <button
                    type="button"
                    class="pill"
                    aria-haspopup="listbox"
                    aria-expanded={menu.open()}
                    title="Agent"
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
                    <For
                      each={options().filter(
                        (agent) => agent.share === 'system'
                      )}
                    >
                      {(agent) => (
                        <AgentOption
                          agent={agent}
                          checked={agent.id === selected()?.id}
                          onSelect={() => {
                            pick(agent.id);
                            close();
                          }}
                        />
                      )}
                    </For>
                    <Show
                      when={options().some((agent) => agent.share !== 'system')}
                    >
                      <MenuGroup>Your agents</MenuGroup>
                      <For
                        each={options().filter(
                          (agent) => agent.share !== 'system'
                        )}
                      >
                        {(agent) => (
                          <AgentOption
                            agent={agent}
                            checked={agent.id === selected()?.id}
                            onSelect={() => {
                              pick(agent.id);
                              close();
                            }}
                          />
                        )}
                      </For>
                    </Show>
                    <div class="foot">
                      <span class="cnt">
                        {options().length}{' '}
                        {options().length === 1 ? 'agent' : 'agents'}
                      </span>
                      <button
                        type="button"
                        class="cta sm"
                        onClick={() => {
                          close();
                          props.onOpenRoster('agent');
                        }}
                      >
                        <PlusIcon class="ph" />
                        Create agent
                      </button>
                    </div>
                  </>
                )}
              </MenuAnchor>

              <Show when={selected() && models().length > 0}>
                <MenuAnchor
                  menuLabel="Model"
                  trigger={(menu) => (
                    <button
                      type="button"
                      class="pill"
                      aria-haspopup="listbox"
                      aria-expanded={menu.open()}
                      title="Model"
                      onClick={(event) => {
                        event.stopPropagation();
                        menu.toggle();
                      }}
                    >
                      <span class="logo">
                        <ProviderIcon model={currentModelId()} class="size-4" />
                      </span>
                      <span class="lbl truncate">
                        <Show
                          when={modelOverride()}
                          fallback={
                            <Show
                              when={props.mode === 'code'}
                              fallback={
                                <>
                                  <span class="k">default</span> (
                                  {modelName(selected()?.defaultModel)})
                                </>
                              }
                            >
                              <span class="k">default</span>&nbsp;
                              <span class="mono">
                                {selected()?.defaultModel ?? 'default'}
                              </span>
                            </Show>
                          }
                        >
                          {(override) => (
                            <Show
                              when={props.mode === 'code'}
                              fallback={modelName(override())}
                            >
                              <span class="mono">{override()}</span>
                            </Show>
                          )}
                        </Show>
                      </span>
                      <CaretDownIcon class="ph caret" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <Show when={props.mode === 'code'}>
                        <div class="filter">
                          <MagnifyingGlassIcon class="ph" />
                          <input
                            placeholder="Filter models"
                            aria-label="Filter models"
                            value={modelFilter()}
                            onInput={(event) =>
                              setModelFilter(event.currentTarget.value)
                            }
                          />
                        </div>
                      </Show>
                      <MenuOption
                        checked={!modelOverride()}
                        onSelect={() => {
                          setModelOverride(undefined);
                          close();
                        }}
                      >
                        <span class="logo">
                          <ProviderIcon
                            model={selected()?.defaultModel}
                            class="size-4"
                          />
                        </span>
                        <span class="nm">
                          Agent default{' '}
                          <span style={{ color: 'var(--ink-placeholder)' }}>
                            · {modelName(selected()?.defaultModel)}
                          </span>
                        </span>
                        <span class="id mono">{selected()?.defaultModel}</span>
                      </MenuOption>
                      <For each={providers()}>
                        {(provider) => (
                          <Show when={filteredModels(provider).length > 0}>
                            <MenuGroup>
                              {PROVIDER_NAMES[provider] ?? provider}
                            </MenuGroup>
                            <For each={filteredModels(provider)}>
                              {(model) => (
                                <MenuOption
                                  checked={modelOverride() === model.id}
                                  onSelect={() => {
                                    setModelOverride(model.id);
                                    close();
                                  }}
                                >
                                  <span class="logo">
                                    <ProviderIcon
                                      model={model.id}
                                      class="size-4"
                                    />
                                  </span>
                                  <span class="nm">{model.name}</span>
                                  <span class="id mono">{model.id}</span>
                                </MenuOption>
                              )}
                            </For>
                          </Show>
                        )}
                      </For>
                      <div class="foot">
                        <span>
                          Offered by{' '}
                          <span class="mono">{selected()?.runtime.label}</span>
                        </span>
                        <span>{models().length} models</span>
                      </div>
                    </>
                  )}
                </MenuAnchor>
              </Show>

              <MenuAnchor
                menuLabel="Repository"
                trigger={(menu) => (
                  <button
                    type="button"
                    id="repoPill"
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
                      <GithubIcon
                        class="ph"
                        style={{ width: '16px', height: '16px' }}
                      />
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
                        onInput={(event) =>
                          setRepoInput(event.currentTarget.value)
                        }
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
                      <span>Optional · clones into the sandbox</span>
                      <span>{repositories.urls().length} repos</span>
                    </div>
                  </>
                )}
              </MenuAnchor>

              <div class="grow" />
              <button
                type="button"
                class="icon-btn"
                aria-label="Mention"
                onClick={mention}
              >
                <AtIcon class="ph" style={{ width: '16px', height: '16px' }} />
              </button>
              <span class="sendwrap">
                <span class="hint" aria-hidden="true">
                  <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
                  <kbd>↵</kbd>
                </span>
                <button
                  type="button"
                  class="send"
                  aria-label="Send"
                  title={blocked()}
                  disabled={!canSend()}
                  onClick={send}
                >
                  <ArrowUpIcon class="ph" />
                </button>
              </span>
            </div>
          </div>
        </div>
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
      disabled={!!props.agent.unavailableReason}
      onSelect={props.onSelect}
    >
      <span class="logo">
        <AgentIcon agent={props.agent} class="ph" />
      </span>
      <span class="nm">{props.agent.name}</span>
      <span class="hint">@{props.agent.handle}</span>
      <Show when={props.agent.kind === 'coder'}>
        <span class="badge coder" title="Coder">
          <CodeIcon class="ph" />
        </span>
      </Show>
      <Show when={props.agent.share === 'system'}>
        <span class="badge system sysb">system</span>
      </Show>
    </MenuOption>
  );
}
