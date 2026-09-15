import { botAssignableChannelOptions } from '@app/features/channel/Bots/botChannelOptions';
import {
  addMcpServer,
  catalogEntryToMcpServer,
  removeMcpServer,
} from '@app/features/settings/agentMcpServers';
import { useChannelsContext } from '@core/context/channels';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { createPipedreamCatalogSearch } from '@core/pipedream/catalog';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import MacroLogo from '@icon/macro-logo.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import type {
  AgentWithHarnessId,
  CreateAgentParams,
} from '@queries/agents/agents';
import { useAgentModelsQueries } from '@queries/agents/models';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import type { AgentMcpServers } from '@service-storage/generated/schemas/agentMcpServers';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { AgentIcon, CodeMark } from '../components/AgentGlyph';
import { ArtifactDialog } from '../components/ArtifactDialog';
import { Segmented } from '../components/Segmented';
import { type AgentKind, isCoderHarness } from '../core/agent-kind';
import type { ConnectedRuntime } from '../queries/connected-runtimes';

function slugTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Create or edit an agent: identity and settings on the left, instructions
 * on the right. A coder is an agent bound to a coding runtime, so the Coder
 * switch decides whether the Runtime list shows and what the save sends.
 */
export function AgentEditorDialog(props: {
  agent?: AgentWithHarnessId;
  initialKind: AgentKind;
  runtimes: readonly ConnectedRuntime[];
  currentTeamId?: string;
  canShareWithTeam: boolean;
  canMakePrivate: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (agent: CreateAgentParams) => Promise<boolean>;
  onDelete?: () => void;
}) {
  const isNew = () => props.agent === undefined;
  const coderRuntimes = () =>
    props.runtimes.filter((runtime) => runtime.id !== 'in-memory');
  const [coder, setCoder] = createSignal(
    props.agent
      ? isCoderHarness(props.agent.harness)
      : props.initialKind === 'coder'
  );
  const noun = () => (coder() ? 'coder' : 'agent');
  const [name, setName] = createSignal(props.agent?.bot.name ?? '');
  const [tag, setTag] = createSignal(props.agent?.bot.handle ?? '');
  const [tagEdited, setTagEdited] = createSignal(props.agent !== undefined);
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(
    props.agent?.bot.avatar_url ?? undefined
  );
  const [instructions, setInstructions] = createSignal(
    props.agent?.instructions ?? ''
  );
  const [harnessId, setHarnessId] = createSignal(
    props.agent?.harness_id ??
      props.agent?.harness ??
      (coder() ? coderRuntimes()[0]?.id : 'in-memory') ??
      ''
  );
  let avatarInput: HTMLInputElement | undefined;

  // Model discovery per runtime, so switching runtimes swaps the catalog.
  const modelQueries = useAgentModelsQueries(() =>
    props.runtimes.map((runtime) => runtime.target)
  );
  const runtime = () =>
    props.runtimes.find((candidate) => candidate.id === harnessId());
  const modelQueryFor = (id: string) => {
    const index = props.runtimes.findIndex((candidate) => candidate.id === id);
    return index >= 0 ? modelQueries[index] : undefined;
  };
  const modelDataFor = (id: string) => {
    const query = modelQueryFor(id);
    return query?.isSuccess ? query.data : undefined;
  };
  const preferredModelId = (id: string) => {
    const data = modelDataFor(id);
    if (data?.status === 'unsupported') return 'default';
    if (data?.status !== 'available') return '';
    const current = data.currentModel;
    if (
      current &&
      (data.models.length === 0 ||
        data.models.some((model) => model.id === current))
    ) {
      return current;
    }
    return data.models[0]?.id ?? '';
  };
  const [defaultModelId, setDefaultModelId] = createSignal(
    props.agent?.default_model ?? ''
  );
  const selectedDefaultModelId = () =>
    defaultModelId() || preferredModelId(harnessId());
  const modelOptions = () => {
    const data = modelDataFor(harnessId());
    if (data?.status !== 'available') return [];
    const selected = selectedDefaultModelId();
    const saved =
      props.agent?.default_model === selected &&
      (props.agent.harness_id ?? props.agent.harness) === harnessId();
    if (!selected || data.models.some((model) => model.id === selected)) {
      return data.models;
    }
    return [
      ...data.models,
      {
        id: selected,
        name: `${selected} (${saved ? 'saved, ' : ''}unavailable)`,
        description: undefined,
        group: undefined,
      },
    ];
  };

  const changeRuntime = (id: string) => {
    setHarnessId(id);
    setDefaultModelId(preferredModelId(id));
  };
  const setCoderMode = (on: boolean) => {
    if (on && coderRuntimes().length === 0) return;
    setCoder(on);
    changeRuntime(on ? (coderRuntimes()[0]?.id ?? '') : 'in-memory');
  };

  const [channelMode, setChannelMode] = createSignal<'all' | 'selected'>(
    props.agent?.channel_scope ?? 'all'
  );
  const [selectedChannelIds, setSelectedChannelIds] = createSignal<string[]>(
    props.agent?.channel_ids ?? []
  );
  const channelsContext = useChannelsContext();
  const channels = createMemo(() =>
    botAssignableChannelOptions(channelsContext.channels())
  );
  const toggleChannel = (id: string) =>
    setSelectedChannelIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  const [share, setShare] = createSignal<'private' | 'team'>(
    props.agent?.bot.owner?.type === 'team' ? 'team' : 'private'
  );

  const pipedreamMcp = usePipedreamMcpFlag();
  const connections = usePipedreamConnectedSlugs();
  const [mcp, setMcp] = createSignal<AgentMcpServers>(
    props.agent?.mcp ?? { scope: 'owner_connections' }
  );
  const picked = (): AgentMcpServer[] => {
    const current = mcp();
    return current.scope === 'selected' ? current.servers : [];
  };
  // Picks survive a round trip through "All my MCPs", so comparing the two
  // does not throw the list away.
  let remembered: AgentMcpServer[] = picked();
  const setMcpScope = (scope: AgentMcpServers['scope']) => {
    if (scope === 'selected')
      setMcp({ scope: 'selected', servers: remembered });
    else {
      remembered = picked();
      setMcp({ scope: 'owner_connections' });
    }
  };
  const setPicked = (servers: AgentMcpServer[]) => {
    remembered = servers;
    setMcp({ scope: 'selected', servers });
  };
  const pickedSlugs = createMemo<ReadonlySet<string>>(
    () => new Set(picked().map((server) => server.app_slug))
  );
  const catalog = createPipedreamCatalogSearch(pickedSlugs);

  const handleNameInput = (value: string) => {
    setName(value);
    if (!tagEdited()) setTag(slugTag(value));
  };
  const handleAvatar = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') setAvatarUrl(reader.result);
    });
    reader.readAsDataURL(file);
  };

  const canSave = () =>
    !props.pending &&
    name().trim().length > 0 &&
    tag().trim().length > 0 &&
    runtime() !== undefined &&
    selectedDefaultModelId().length > 0 &&
    (channelMode() === 'all' || selectedChannelIds().length > 0) &&
    (mcp().scope === 'owner_connections' || picked().length > 0) &&
    (share() === 'private' ? props.canMakePrivate : props.canShareWithTeam);

  const submit = async () => {
    const current = runtime();
    if (!canSave() || !current) return;
    const owner = props.agent?.bot.owner;
    const saved = await props.onSave({
      avatarUrl: avatarUrl(),
      channelIds: channelMode() === 'all' ? [] : selectedChannelIds(),
      channelScope: channelMode(),
      defaultModel: selectedDefaultModelId(),
      handle: slugTag(tag()),
      // Paired macrod runtimes send the 'macrod' slug plus their uuid;
      // built-ins send their own slug with no runtime id.
      harness: current.kind === 'macrod' ? 'macrod' : current.id,
      harnessId: current.kind === 'macrod' ? current.id : undefined,
      name: name().trim(),
      instructions: instructions().trim(),
      mcp: mcp(),
      teamId:
        share() === 'team'
          ? owner?.type === 'team'
            ? owner.team_id
            : props.currentTeamId
          : undefined,
    });
    if (saved) props.onClose();
  };

  const glyphAgent = () => ({
    id: props.agent?.bot.id ?? 'new',
    name: name() || 'Agent',
  });

  return (
    <ArtifactDialog
      class="xwide fixed"
      label={`${isNew() ? 'Create' : 'Edit'} ${noun()}`}
      onClose={props.onClose}
    >
      <div class="dh">
        <span class="t">
          <AgentIcon agent={glyphAgent()} />
          {isNew() ? 'Create' : 'Edit'} {noun()}
        </span>
        <span class="hr">
          <Segmented
            name="share"
            value={share()}
            options={[
              {
                value: 'private',
                label: 'Private',
                icon: 'lock',
                disabled: !props.canMakePrivate,
              },
              {
                value: 'team',
                label: 'Team',
                icon: 'team',
                disabled: !props.canShareWithTeam,
              },
            ]}
            onChange={setShare}
          />
          <button type="button" class="icon-btn" aria-label="Close" data-close>
            <XIcon class="ph" />
          </button>
        </span>
      </div>
      <div class="db">
        <div class="cols agent">
          <div class="colL">
            <div class="avrow" style={{ border: 0, padding: 0 }}>
              <span class="avw">
                <button
                  type="button"
                  class="bigav"
                  aria-label="Change avatar"
                  onClick={() => avatarInput?.click()}
                >
                  <Show
                    when={avatarUrl()}
                    fallback={<AgentIcon agent={glyphAgent()} />}
                  >
                    {(url) => (
                      <img
                        src={url()}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          'object-fit': 'cover',
                          'border-radius': 'inherit',
                        }}
                      />
                    )}
                  </Show>
                </button>
                <CodeMark hidden={!coder()} />
              </span>
              <input
                ref={avatarInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) =>
                  handleAvatar(event.currentTarget.files?.[0])
                }
              />
              <div style={{ 'min-width': 0, flex: 1 }}>
                <input
                  class="sinput"
                  aria-label="Agent name"
                  placeholder="Agent name"
                  style={{ 'font-weight': 500 }}
                  value={name()}
                  onInput={(event) =>
                    handleNameInput(event.currentTarget.value)
                  }
                />
                <span class="tagin" style={{ 'margin-top': '6px' }}>
                  <span class="at">@</span>
                  <input
                    aria-label="@tag"
                    placeholder="tag"
                    value={tag()}
                    onInput={(event) => {
                      setTagEdited(true);
                      setTag(slugTag(event.currentTarget.value));
                    }}
                  />
                </span>
              </div>
            </div>

            <Show when={coder()}>
              <div class="divider" />
              <p class="grp-h">Runtime</p>
              <div class="plist" role="radiogroup" aria-label="Runtime">
                <For
                  each={coderRuntimes()}
                  fallback={
                    <p class="empty">
                      Connect Cursor or pair a runtime, then come back.
                    </p>
                  }
                >
                  {(candidate) => (
                    <button
                      type="button"
                      class="prow"
                      role="radio"
                      aria-checked={harnessId() === candidate.id}
                      onClick={() => changeRuntime(candidate.id)}
                    >
                      <span class="cb rd" />
                      <Show
                        when={candidate.kind === 'macrod'}
                        fallback={
                          <Show
                            when={candidate.id === 'cursor'}
                            fallback={<MacroLogo class="ph" />}
                          >
                            <CursorIcon class="ph" />
                          </Show>
                        }
                      >
                        <PlugsIcon class="ph" />
                      </Show>
                      <span class="truncate">{candidate.name}</span>
                      <span class="meta">
                        <Show
                          when={candidate.kind === 'macrod'}
                          fallback={
                            candidate.id === 'cursor' ? 'cloud' : 'built in'
                          }
                        >
                          <span class={candidate.connected ? 'on' : 'off'}>
                            {candidate.connected ? 'Connected' : 'Disconnected'}
                          </span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="srow">
              <span class="lab">Default model</span>
              <Show
                when={modelQueryFor(harnessId())}
                fallback={
                  <span class="sinput sm" style={{ color: 'var(--ink-muted)' }}>
                    Model discovery unavailable
                  </span>
                }
              >
                {(query) => (
                  <Switch>
                    <Match when={query().isPending}>
                      <select
                        class="sinput sm"
                        aria-label="Default model"
                        disabled
                      >
                        <option>Loading models…</option>
                      </select>
                    </Match>
                    <Match when={query().isError}>
                      <span
                        style={{ 'font-size': '12px', color: 'var(--red)' }}
                      >
                        Could not load models.{' '}
                        <button
                          type="button"
                          class="link-btn"
                          onClick={() => void query().refetch()}
                        >
                          Retry
                        </button>
                      </span>
                    </Match>
                    <Match
                      when={modelDataFor(harnessId())?.status !== 'available'}
                    >
                      <span
                        class="sinput sm"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        Chosen by the runtime
                      </span>
                    </Match>
                    <Match when={true}>
                      <select
                        class="sinput sm"
                        aria-label="Default model"
                        value={selectedDefaultModelId()}
                        onChange={(event) =>
                          setDefaultModelId(event.currentTarget.value)
                        }
                      >
                        <For each={modelOptions()}>
                          {(model) => (
                            <option value={model.id}>{model.name}</option>
                          )}
                        </For>
                      </select>
                    </Match>
                  </Switch>
                )}
              </Show>
            </div>

            <Show when={pipedreamMcp()}>
              <div class="divider" />
              <div class="grp-row">
                <p class="grp-h">Connections</p>
                <Segmented
                  name="mcp"
                  value={mcp().scope}
                  options={[
                    { value: 'owner_connections', label: 'All my MCPs' },
                    { value: 'selected', label: 'Specific MCPs' },
                  ]}
                  onChange={setMcpScope}
                />
              </div>
              <Show
                when={mcp().scope === 'selected'}
                fallback={
                  <p
                    style={{
                      margin: 0,
                      'font-size': '12px',
                      color: 'var(--ink-disabled)',
                    }}
                  >
                    The agent can use every app the person running it has
                    connected.
                  </p>
                }
              >
                <div class="picker">
                  <div class="csearch">
                    <MagnifyingGlassIcon class="ph" />
                    <input
                      placeholder="Search all connectors…"
                      aria-label="Search connectors"
                      value={catalog.searchInput()}
                      onInput={(event) =>
                        catalog.onSearchInput(event.currentTarget.value)
                      }
                    />
                  </div>
                  <Show when={catalog.searchInput().trim().length > 0}>
                    <div class="results" aria-label="Connector results">
                      <Show
                        when={
                          !catalog.query.isPending &&
                          catalog.entries().length === 0
                        }
                      >
                        <div class="empty">No connectors match.</div>
                      </Show>
                      <For each={catalog.entries()}>
                        {(entry) => (
                          <button
                            type="button"
                            class="crow"
                            onClick={() => {
                              setPicked(
                                addMcpServer(
                                  picked(),
                                  catalogEntryToMcpServer(entry)
                                )
                              );
                              catalog.onSearchInput('');
                            }}
                          >
                            <span class="mk">
                              <PipedreamConnectorIcon
                                appSlug={entry.app_slug}
                                class="size-4"
                              />
                            </span>
                            <span style={{ 'min-width': 0 }}>
                              <span class="nm truncate">
                                {entry.display_name}
                              </span>
                              <span class="ds truncate">
                                {entry.description}
                              </span>
                            </span>
                            <span class="add">
                              <PlusIcon class="ph" />
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="picked">
                    <For
                      each={picked()}
                      fallback={
                        <p class="none">
                          No apps picked yet. Search above to add one — you can
                          connect your account later.
                        </p>
                      }
                    >
                      {(server) => (
                        <div class="crow">
                          <span class="mk">
                            <PipedreamConnectorIcon
                              appSlug={server.app_slug}
                              class="size-5"
                            />
                          </span>
                          <span style={{ 'min-width': 0 }}>
                            <span class="nm truncate">
                              {server.server_name}
                            </span>
                            <span class="ds truncate">
                              {connections.ready()
                                ? connections.slugs().has(server.app_slug)
                                  ? 'Connected'
                                  : 'Not connected'
                                : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label={`Remove ${server.server_name}`}
                            onClick={() =>
                              setPicked(
                                removeMcpServer(picked(), server.app_slug)
                              )
                            }
                          >
                            <XIcon class="ph" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>

            <div class="divider" />
            <div class="grp-row">
              <p class="grp-h">Channels</p>
              <Segmented
                name="ch"
                value={channelMode()}
                options={[
                  { value: 'all', label: 'All channels' },
                  { value: 'selected', label: 'Specific' },
                ]}
                onChange={setChannelMode}
              />
            </div>
            <Show when={channelMode() === 'selected'}>
              <div class="plist scroll" aria-label="Channels">
                <For
                  each={channels()}
                  fallback={<p class="empty">No channels to pick from.</p>}
                >
                  {(channel) => (
                    <button
                      type="button"
                      class="prow"
                      role="checkbox"
                      aria-checked={selectedChannelIds().includes(channel.id)}
                      onClick={() => toggleChannel(channel.id)}
                    >
                      <span class="cb">
                        <CheckIcon class="ph" />
                      </span>
                      <span class="mk">#</span>
                      <span class="truncate">{channel.name}</span>
                      <span class="meta" />
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="divider" />
            <div class="srow">
              <span class="lab">
                Coder
                <small>
                  {coderRuntimes().length === 0
                    ? 'Connect Cursor or pair a runtime to make coders'
                    : 'Writes code: takes a repository, runs on a runtime, and appears under Coders'}
                </small>
              </span>
              <button
                type="button"
                class="switch"
                role="switch"
                aria-checked={coder()}
                aria-disabled={
                  coderRuntimes().length === 0 && !coder() ? true : undefined
                }
                style={
                  coderRuntimes().length === 0 && !coder()
                    ? { opacity: 0.7 }
                    : undefined
                }
                onClick={() => setCoderMode(!coder())}
              >
                <span class="trk" />
                <span class="sw-l">{coder() ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>

          <div class="colR">
            <div class="mdwrap">
              <div class="mdbar">
                <span class="lbl">Instructions</span>
              </div>
              <textarea
                class="always"
                aria-label="Instructions"
                spellcheck={false}
                placeholder="You are…"
                value={instructions()}
                onInput={(event) => setInstructions(event.currentTarget.value)}
              />
            </div>
          </div>
        </div>
      </div>
      <div class="df">
        <Show when={!isNew() && props.onDelete} fallback={<span />}>
          {(onDelete) => (
            <button type="button" class="btn danger" onClick={onDelete()}>
              <TrashIcon class="ph" />
              Delete <span class="noun">{noun()}</span>
            </button>
          )}
        </Show>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" class="btn quiet" data-close>
            Cancel
          </button>
          <button
            type="button"
            class="btn"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
            }}
            disabled={!canSave()}
            onClick={() => void submit()}
          >
            {props.pending
              ? isNew()
                ? 'Creating…'
                : 'Saving…'
              : isNew()
                ? `Create ${noun()}`
                : 'Save changes'}
          </button>
        </div>
      </div>
    </ArtifactDialog>
  );
}
