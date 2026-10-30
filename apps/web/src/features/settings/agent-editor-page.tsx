import {
  type AgentKind,
  isCoderHarness,
} from '@app/features/agents-view/core/agent-kind';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { toast } from '@core/component/Toast/Toast';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { fireAndForget } from '@core/util/fireAndForget';
import MacroLogo from '@icon/macro-logo.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import TerminalIcon from '@icon/system/regular/terminal-window.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { Telemetry } from '@macro-inc/observability';
import {
  removeAgentApiKey,
  saveAgentApiKey,
  useAgentApiKeyQuery,
} from '@queries/agents/agent-api-key';
import type {
  AgentWithHarnessId,
  CreateAgentParams,
} from '@queries/agents/agents';
import { useUploadAgentAvatarMutation } from '@queries/agents/avatar';
import { useAgentModelsQueries } from '@queries/agents/models';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import type { AgentMcpServers } from '@service-storage/generated/schemas/agentMcpServers';
import { ApiKeyInput, Button, cn, InputGroup } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { AgentCreateWizard, type WizardStep } from './agent-create-wizard';
import { CursorConnectPage } from './CursorConnectPage';
import {
  AgentChannelFields,
  AgentShareFields,
} from './components/agent-access-fields';
import { AdvancedGroup } from './components/agent-advanced-group';
import {
  AgentEditFrame,
  AgentEditHero,
  AgentEditSection,
} from './components/agent-edit-frame';
import { createDarkTheme } from './components/agent-face';
import { agentFaceImage } from './components/agent-face-paint';
import { AgentLookFields } from './components/agent-look-fields';
import { AgentModelPicker } from './components/agent-model-picker';
import { AgentInstructionsEditor } from './components/instructions-editor';
import { SettingsSelect } from './components/settings-select';
import { WhereItRunsOption } from './components/where-it-runs-option';
import {
  type ApiKeyProvider,
  apiKeyProviderName,
  apiKeyProviderOf,
} from './core/agent-api-key';
import {
  type AgentFaceLook,
  agentFaceColor,
  agentFaceLook,
} from './core/agent-face';
import {
  type AgentShare,
  type ChannelMode,
  type ConnectedHarness,
  IN_MEMORY_HARNESS,
  slugAgentTag,
} from './core/agent-settings';
import { PipedreamAppPicker } from './PipedreamAppPicker';
import { ChoiceRow, SettingsSurface } from './primitives';
import { RuntimePairingPage } from './RuntimePairingPage';

/**
 * Creating an agent is a step-by-step wizard; editing one is a full-page form.
 * Both share the same fields and save through `onSave`.
 */
export function AgentEditorPage(props: {
  initialKind?: AgentKind;
  agent?: AgentWithHarnessId;
  connectedHarnesses: readonly ConnectedHarness[];
  currentTeamId?: string;
  canShareWithTeam: boolean;
  canMakePrivate: boolean;
  pending: boolean;
  onClose: () => void;
  /** Saves the agent, resolving to its id, or `undefined` when it failed. */
  onSave: (agent: CreateAgentParams) => Promise<string | undefined>;
  onDelete?: () => void;
  /** Opens a direct message with the agent the wizard just created. */
  onMessage?: (agentId: string) => void;
}) {
  const [name, setName] = createSignal(props.agent?.bot.name ?? '');
  const [tag, setTag] = createSignal(props.agent?.bot.handle ?? '');
  const [tagEdited, setTagEdited] = createSignal(props.agent !== undefined);
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(
    props.agent?.bot.avatar_url ?? undefined
  );
  // An existing agent's picture doesn't say which face it shows, so the edit
  // page's picker starts unchosen, drawn in the face its @tag would get.
  const [pickedLook, setPickedLook] = createSignal<AgentFaceLook>();
  const dark = createDarkTheme();
  const uploadAvatar = useUploadAgentAvatarMutation();
  const [uploadingAvatar, setUploadingAvatar] = createSignal(false);
  const busy = () => props.pending || uploadingAvatar();
  const [instructions, setInstructions] = createSignal(
    props.agent?.instructions ?? ''
  );
  const [harnessId, setHarnessId] = createSignal(
    props.agent?.harness_id ??
      props.agent?.harness ??
      (props.initialKind === 'coder'
        ? props.connectedHarnesses.find((harness) =>
            isCoderHarness(harness.kind === 'macrod' ? 'macrod' : harness.id)
          )?.id
        : undefined) ??
      props.connectedHarnesses[0]?.id ??
      ''
  );
  const modelQueries = useAgentModelsQueries(() =>
    props.connectedHarnesses.map((harness) => harness.target)
  );
  const selectedHarness = () =>
    props.connectedHarnesses.find((harness) => harness.id === harnessId());
  const modelQueryForHarness = (id: string) => {
    const index = props.connectedHarnesses.findIndex(
      (harness) => harness.id === id
    );
    return index >= 0 ? modelQueries[index] : undefined;
  };
  const modelDataForHarness = (id: string) => {
    const query = modelQueryForHarness(id);
    return query?.isSuccess ? query.data : undefined;
  };
  const preferredModelId = (id: string) => {
    const data = modelDataForHarness(id);
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
  const selectedModelQuery = () => modelQueryForHarness(harnessId());
  const selectedModelData = () => modelDataForHarness(harnessId());
  const selectedModelOptions = () => {
    const data = selectedModelData();
    if (data?.status !== 'available') return [];

    const selected = selectedDefaultModelId();
    const savedModel =
      props.agent?.default_model === selected &&
      (props.agent.harness_id ?? props.agent.harness) === harnessId();
    if (
      selected.length === 0 ||
      data.models.some((model) => model.id === selected)
    ) {
      return data.models;
    }
    return [
      ...data.models,
      {
        id: selected,
        name: `${selected} (${savedModel ? 'saved, ' : ''}unavailable)`,
        description: undefined,
        group: undefined,
      },
    ];
  };
  const selectedCatalogOptions = () =>
    selectedModelOptions().map((model) => ({
      id: model.id,
      // The built-in runtime reports slugs as names; other runtimes name
      // their own models.
      label:
        harnessId() === IN_MEMORY_HARNESS.id
          ? modelLabel(model.id, model.name)
          : model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const [channelMode, setChannelMode] = createSignal<ChannelMode>(
    props.agent?.channel_scope ?? 'all'
  );
  const [selectedChannelIds, setSelectedChannelIds] = createSignal<string[]>(
    props.agent?.channel_ids ?? []
  );
  const [share, setShare] = createSignal<AgentShare>(
    props.agent?.bot.owner?.type === 'team' ? 'Team' : 'Private'
  );
  const pipedreamMcp = usePipedreamMcpFlag();
  const connections = usePipedreamConnectedSlugs();
  const [mcp, setMcp] = createSignal<AgentMcpServers>(
    props.agent?.mcp ?? { scope: 'owner_connections' }
  );
  const selectedMcpServers = (): AgentMcpServer[] => {
    const current = mcp();
    return current.scope === 'selected' ? current.servers : [];
  };
  // Picks survive a round trip through "Use my connected apps", so toggling
  // the radio to compare does not throw the list away.
  let rememberedMcpServers: AgentMcpServer[] = selectedMcpServers();
  const setMcpScope = (scope: AgentMcpServers['scope']) => {
    if (scope === 'selected') {
      setMcp({ scope: 'selected', servers: rememberedMcpServers });
    } else {
      rememberedMcpServers = selectedMcpServers();
      setMcp({ scope: 'owner_connections' });
    }
  };
  const setSelectedMcpServers = (servers: AgentMcpServer[]) => {
    rememberedMcpServers = servers;
    setMcp({ scope: 'selected', servers });
  };
  const [autoAcceptChoice, setAutoAcceptChoice] = createSignal(
    props.agent?.auto_accept_permissions === true
  );
  const allowPermissionBypass = () =>
    selectedHarness()?.allowPermissionBypass === true;
  const autoAcceptPermissions = () =>
    selectedHarness()?.kind === 'builtin' ||
    (allowPermissionBypass() && autoAcceptChoice());
  // The saved choice, or none: an agent that never chose follows its
  // harness, so a fresh form and a re-picked runtime both start from there.
  const [codingChoice, setCodingChoice] = createSignal<boolean | undefined>(
    props.agent?.is_coding ??
      (props.initialKind ? props.initialKind === 'coder' : undefined)
  );
  const harnessCodes = () => {
    const harness = selectedHarness();
    return isCoderHarness(harness?.kind === 'macrod' ? 'macrod' : harness?.id);
  };
  const isCoding = () => codingChoice() ?? harnessCodes();
  let pageContentRef: HTMLDivElement | undefined;

  const [setup, setSetup] = createSignal<'cursor' | 'pairing'>();
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const cursorHarness = () =>
    props.connectedHarnesses.find((harness) => harness.id === 'cursor');
  const macrodHarnesses = () =>
    props.connectedHarnesses.filter((harness) => harness.kind === 'macrod');
  // Back from a setup guide, land on what was just set up.
  const finishSetup = () => {
    const finished = setup();
    setSetup(undefined);
    const ready =
      finished === 'cursor' ? cursorHarness() : macrodHarnesses()[0];
    if (ready) handleHarnessChange(ready.id);
  };
  const advancedSummary = () =>
    [
      isCoding() ? 'Coding agent' : 'Chat agent',
      ...(pipedreamMcp()
        ? [
            mcp().scope === 'owner_connections'
              ? 'Your connected apps'
              : `${selectedMcpServers().length} selected apps`,
          ]
        : []),
    ].join(' · ');
  const modelPicker = () => (
    <AgentModelPicker
      query={selectedModelQuery()}
      runtimeName={selectedHarness()?.name}
      available={selectedModelData()?.status === 'available'}
      options={selectedCatalogOptions()}
      value={selectedDefaultModelId()}
      onChange={setDefaultModelId}
    />
  );
  const modelField = () => <div class="max-w-[280px]">{modelPicker()}</div>;

  // An agent that runs in Macro on an Anthropic or OpenAI model can run on
  // its own API key instead of Macro usage. The key is write-only: a saved
  // one shows masked, and is replaced by typing a new one.
  const apiKey = useAgentApiKeyQuery(() => props.agent?.bot.id);
  const [apiKeyDraft, setApiKeyDraft] = createSignal('');
  const [removingApiKey, setRemovingApiKey] = createSignal(false);
  const keyProvider = () =>
    harnessId() === IN_MEMORY_HARNESS.id
      ? apiKeyProviderOf(selectedDefaultModelId())
      : undefined;
  // A new agent has no id yet, so its query stays disabled; read the data
  // only once it has loaded, or the editor would suspend on it.
  const apiKeyData = () => (apiKey.isSuccess ? apiKey.data : undefined);
  const savedApiKey = () =>
    removingApiKey() ? undefined : (apiKeyData()?.key ?? undefined);
  const apiKeyLocked = () => apiKeyData()?.planAllows === false;
  const apiKeyHelp = (provider: ApiKeyProvider) => {
    const saved = savedApiKey();
    if (apiKeyLocked())
      return saved
        ? 'Agent API keys are part of the Premium and Max plans. This agent runs on Macro usage until you upgrade.'
        : 'Agent API keys are part of the Premium and Max plans.';
    if (saved && saved.provider !== provider.id)
      return `The saved ${apiKeyProviderName(saved.provider)} key isn’t used with this model.`;
    return 'Bill usage to your own API key.';
  };
  const apiKeyField = () => (
    <Show when={keyProvider()}>
      {(provider) => (
        <div class="flex max-w-[420px] flex-col gap-1.5">
          <span class="text-xs font-medium text-ink-muted">
            {provider().name} API key
          </span>
          <div class="flex min-w-0 items-center gap-2">
            <ApiKeyInput
              aria-label={`${provider().name} API key`}
              class="flex-1"
              prefix={provider().prefix}
              saved={savedApiKey()?.provider === provider().id}
              disabled={busy() || apiKeyLocked()}
              value={apiKeyDraft()}
              onValueChange={setApiKeyDraft}
            />
            <Show when={savedApiKey()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy()}
                onClick={() => {
                  setApiKeyDraft('');
                  setRemovingApiKey(true);
                }}
              >
                Remove
              </Button>
            </Show>
          </div>
          <p class="text-xs text-ink-extra-muted">{apiKeyHelp(provider())}</p>
        </div>
      )}
    </Show>
  );
  // Saved after the agent, which a new agent needs an id from first.
  const saveApiKey = async (agentId: string) => {
    const draft = apiKeyDraft().trim();
    try {
      if (draft.length > 0 && keyProvider()) {
        await saveAgentApiKey(agentId, draft);
      } else if (removingApiKey()) {
        await removeAgentApiKey(agentId);
      }
    } catch (error) {
      toast.failure(
        `The agent was saved, but not its API key: ${
          error instanceof Error && error.message
            ? error.message
            : 'something went wrong'
        }`
      );
    }
  };

  const close = () => {
    if (!busy()) props.onClose();
  };

  const handleNameInput = (value: string) => {
    setName(value);
    if (!tagEdited()) setTag(slugAgentTag(value));
  };

  const handleHarnessChange = (id: string) => {
    setHarnessId(id);
    setDefaultModelId(preferredModelId(id));
    setAutoAcceptChoice(false);
    setCodingChoice(undefined);
  };

  const uploadFace = async (face: AgentFaceLook) => {
    setUploadingAvatar(true);
    try {
      return await uploadAvatar.mutateAsync(await agentFaceImage(face));
    } catch (error) {
      toast.failure(
        error instanceof Error
          ? `Couldn’t save the agent’s face: ${error.message}`
          : 'Couldn’t save the agent’s face'
      );
      return undefined;
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAvatarInput = async (file: File | undefined) => {
    if (!file || busy()) return;
    setUploadingAvatar(true);
    try {
      setAvatarUrl(await uploadAvatar.mutateAsync(file));
      setPickedLook(undefined);
    } catch (error) {
      toast.failure(
        error instanceof Error ? error.message : 'Failed to upload avatar'
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const canCreate = () =>
    !busy() &&
    name().trim().length > 0 &&
    tag().trim().length > 0 &&
    selectedHarness() !== undefined &&
    selectedDefaultModelId().length > 0 &&
    (channelMode() === 'all' || selectedChannelIds().length > 0) &&
    (mcp().scope === 'owner_connections' || selectedMcpServers().length > 0) &&
    (share() === 'Private' ? props.canMakePrivate : props.canShareWithTeam);

  const selectedTeamId = () => {
    if (share() === 'Private') return undefined;
    const currentOwner = props.agent?.bot.owner;
    return currentOwner?.type === 'team'
      ? currentOwner.team_id
      : props.currentTeamId;
  };

  /**
   * Saves the agent, resolving to its id, or `undefined` when it failed. A
   * chosen `face` replaces the agent's picture with a picture of that face,
   * so it looks the same wherever agents are shown as images.
   */
  const submit = (face?: AgentFaceLook) =>
    Telemetry.span(
      props.agent ? 'agent.update' : 'agent.create',
      async (span) => {
        if (props.agent) span.setAttr('agent.id', props.agent.bot.id);
        span.setAttr(
          'agent.picture',
          face ? 'face' : avatarUrl() ? 'upload' : 'none'
        );
        if (!canCreate()) {
          span.setAttr('agent.outcome', 'invalid');
          return undefined;
        }
        const picture = face
          ? await span.span('agent.face_upload', () => uploadFace(face))
          : avatarUrl();
        if (face && !picture) {
          span.setAttr('agent.outcome', 'face_upload_failed');
          return undefined;
        }

        const harness = selectedHarness();
        const saved = await span.span('agent.save', () =>
          props.onSave({
            avatarUrl: picture,
            channelIds: channelMode() === 'all' ? [] : selectedChannelIds(),
            channelScope: channelMode(),
            defaultModel: selectedDefaultModelId(),
            handle: slugAgentTag(tag()),
            // Registered macrod harnesses send the 'macrod' slug plus their
            // uuid; built-ins keep sending their own slug with no harness id.
            harness:
              harness?.kind === 'macrod' ? 'macrod' : (harness?.id ?? ''),
            harnessId: harness?.kind === 'macrod' ? harness.id : undefined,
            name: name().trim(),
            instructions: instructions().trim(),
            // Always sent, flag or no flag, so an editor without the
            // Connections section never wipes a selection somebody else made.
            mcp: mcp(),
            teamId: selectedTeamId(),
            autoAcceptPermissions: autoAcceptPermissions(),
            isCoding: isCoding(),
          })
        );
        if (!saved) {
          span.setAttr('agent.outcome', 'save_failed');
          return undefined;
        }
        span.setAttr('agent.id', saved);
        await span.span('agent.api_key', () => saveApiKey(saved));
        span.setAttr('agent.outcome', 'saved');
        if (props.agent) close();
        return saved;
      }
    );

  const nameFields = (layout: 'row' | 'stack') => (
    <>
      <div
        class={cn(
          'grid grid-cols-1 gap-3',
          layout === 'row' && 'mt-4 @min-[440px]:grid-cols-2'
        )}
      >
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">Name</span>
          <input
            class="settings-input w-full"
            placeholder="Bug fixer"
            value={name()}
            onInput={(event) => handleNameInput(event.currentTarget.value)}
          />
        </label>
        <label for="agent-tag" class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">@tag</span>
          <InputGroup>
            <InputGroup.Input
              id="agent-tag"
              aria-label="@tag"
              placeholder="bug-fixer"
              value={tag()}
              onInput={(event) => {
                setTagEdited(true);
                setTag(slugAgentTag(event.currentTarget.value));
              }}
            />
            <InputGroup.Addon align="inline-start">
              <span class="text-ink-extra-muted">@</span>
            </InputGroup.Addon>
          </InputGroup>
        </label>
      </div>
    </>
  );

  const instructionsField = () => (
    <>
      <AgentInstructionsEditor
        markdown={instructions()}
        onChange={setInstructions}
        disabled={props.pending}
        class="rounded-lg border border-edge-muted bg-input px-3 py-2.5 focus-within:border-accent"
        placeholder="Describe your agent’s role, how it should work, and what a good result looks like…"
      />
    </>
  );

  const whereItRunsFields = () => (
    <>
      <fieldset class="flex flex-col gap-2">
        <legend class="sr-only">Where it runs</legend>
        <WhereItRunsOption
          value="in-memory"
          title="In Macro"
          description="Fast and built in. Uses Macro tools and your connected apps."
          icon={<MacroLogo />}
          checked={harnessId() === IN_MEMORY_HARNESS.id}
          onSelect={() => handleHarnessChange(IN_MEMORY_HARNESS.id)}
        >
          <div class="flex flex-col gap-3">
            {modelField()}
            {apiKeyField()}
          </div>
        </WhereItRunsOption>
        <WhereItRunsOption
          value="cursor"
          title="In Cursor"
          description={
            cursorHarness()
              ? 'Runs as a Cursor Cloud agent on your Cursor plan.'
              : 'Connect Cursor first. Runs as a Cursor Cloud agent on your Cursor plan.'
          }
          icon={<CursorIcon />}
          checked={harnessId() === 'cursor'}
          disabled={!cursorHarness()}
          action={
            <Show when={!cursorHarness()}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="text-ink"
                aria-label="Connect Cursor"
                disabled={busy()}
                onClick={() => setSetup('cursor')}
              >
                Connect
              </Button>
            </Show>
          }
          onSelect={() => handleHarnessChange('cursor')}
        >
          {modelField()}
        </WhereItRunsOption>
        <WhereItRunsOption
          value="harness"
          title="In your harness"
          description="Your own agent on your own machine. Local Claude Code, Codex, or other harness, via Macrod."
          icon={<TerminalIcon />}
          checked={selectedHarness()?.kind === 'macrod'}
          disabled={macrodHarnesses().length === 0}
          action={
            <Show when={macrodHarnesses().length === 0}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="text-ink"
                aria-label="Set up your own harness"
                disabled={busy()}
                onClick={() => setSetup('pairing')}
              >
                Set up
              </Button>
            </Show>
          }
          onSelect={() => {
            const first = macrodHarnesses()[0];
            if (first) handleHarnessChange(first.id);
          }}
        >
          <div class="grid grid-cols-1 gap-3 @min-[440px]:grid-cols-[repeat(2,minmax(0,280px))]">
            <div class="flex min-w-0 flex-col gap-1.5">
              <span class="text-xs font-medium text-ink-muted">Harness</span>
              <SettingsSelect
                label="Harness"
                options={macrodHarnesses()}
                value={harnessId()}
                onChange={handleHarnessChange}
              />
            </div>
            {modelPicker()}
          </div>
        </WhereItRunsOption>
      </fieldset>
      <Show when={!keyProvider() ? savedApiKey() : undefined}>
        {(saved) => (
          <div class="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
            <span>
              This agent has a saved {apiKeyProviderName(saved().provider)} API
              key it doesn’t use here.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy()}
              onClick={() => setRemovingApiKey(true)}
            >
              Remove key
            </Button>
          </div>
        )}
      </Show>
    </>
  );

  const shareFields = () => (
    <AgentShareFields
      share={share()}
      canMakePrivate={props.canMakePrivate}
      canShareWithTeam={props.canShareWithTeam}
      onChange={setShare}
    />
  );

  const advancedOptions = () => (
    <>
      <div id="agent-advanced" class="flex flex-col">
        <fieldset class="grid gap-2">
          <legend class="text-xs font-medium text-ink">
            Answering a mention
          </legend>
          <ChoiceRow
            name="agent-coding"
            value="coding"
            title="Coding agent"
            description="Posts a magic chip you can open into the live session and watch it work in a repository."
            checked={isCoding()}
            onChange={() => setCodingChoice(true)}
          />
          <ChoiceRow
            name="agent-coding"
            value="chat"
            title="Chat agent"
            description="Replies in the thread the way a person would, like @macro."
            checked={!isCoding()}
            onChange={() => setCodingChoice(false)}
          />
        </fieldset>
        <Show when={selectedHarness()?.kind === 'macrod'}>
          <fieldset class="mt-4 grid gap-2 border-t border-ink/[0.06] pt-4">
            <legend class="text-xs font-medium text-ink">
              Permission requests
            </legend>
            <ChoiceRow
              name="agent-permission-policy"
              value="prompt"
              title="Always prompt"
              description="Session editors approve or reject each permission request."
              checked={!autoAcceptPermissions()}
              onChange={() => setAutoAcceptChoice(false)}
            />
            <Show
              when={allowPermissionBypass()}
              fallback={
                <p class="text-xs text-ink-muted">
                  This runtime requires permission prompts.
                </p>
              }
            >
              <ChoiceRow
                name="agent-permission-policy"
                value="bypass"
                title="Always bypass"
                suggested
                description="Approve tool calls without asking."
                checked={autoAcceptPermissions()}
                onChange={() => setAutoAcceptChoice(true)}
              />
            </Show>
          </fieldset>
        </Show>

        <Show when={pipedreamMcp()}>
          <AdvancedGroup
            title="Connections"
            description="Which connected apps (MCP tools) this agent can use."
          >
            <fieldset class="flex flex-col gap-2">
              <legend class="sr-only">Connections</legend>
              <ChoiceRow
                name="agent-mcp-mode"
                value="owner_connections"
                checked={mcp().scope === 'owner_connections'}
                title="Use my connected apps"
                description="The agent uses whatever apps the person running it has connected."
                onChange={() => setMcpScope('owner_connections')}
              />
              <ChoiceRow
                name="agent-mcp-mode"
                value="selected"
                checked={mcp().scope === 'selected'}
                title="Specific apps"
                description="Pick apps from the catalog. Each person connects their own account."
                onChange={() => setMcpScope('selected')}
              />
            </fieldset>

            <Show when={mcp().scope === 'selected'}>
              <div class="mt-3 border-t border-edge-muted pt-3">
                <PipedreamAppPicker
                  selected={selectedMcpServers()}
                  onChange={setSelectedMcpServers}
                  connectedSlugs={connections.slugs}
                  connectionsReady={connections.ready}
                  connectContainer={() => pageContentRef}
                />
              </div>
            </Show>

            <Show when={share() === 'Team'}>
              <p class="mt-3 border-t border-edge-muted pt-3 text-xs text-ink-extra-muted">
                Connections are personal. Teammates who use this agent connect
                these apps under Agents → Connections; the indicators here show
                only your own.
              </p>
            </Show>
          </AdvancedGroup>
        </Show>
      </div>
    </>
  );

  const channelFields = () => (
    <AgentChannelFields
      mode={channelMode()}
      channelIds={selectedChannelIds()}
      onModeChange={setChannelMode}
      onChannelIdsChange={setSelectedChannelIds}
    />
  );

  const editLook = () => pickedLook() ?? agentFaceLook(tag() || name());
  const editAccent = () =>
    agentFaceColor(editLook().color).swatch[dark() ? 'dark' : 'light'];
  const lookFields = () => (
    <AgentLookFields
      look={editLook()}
      chosen={pickedLook() !== undefined}
      onChange={setPickedLook}
      showPicker
      busy={busy()}
      uploading={uploadingAvatar()}
      uploadLabel="Upload a picture"
      onUpload={handleAvatarInput}
      secondary={
        pickedLook() && avatarUrl()
          ? {
              label: 'Keep its current picture',
              onClick: () => setPickedLook(undefined),
            }
          : undefined
      }
    />
  );

  const editForm = () => (
    <AgentEditFrame
      accent={editAccent()}
      hero={
        <AgentEditHero
          look={editLook()}
          picture={pickedLook() ? undefined : avatarUrl()}
          name={name()}
          thinking={props.pending}
        />
      }
      title={name().trim() || 'Untitled agent'}
      subtitle={
        <>
          @{tag() || 'agent'} · {share() === 'Team' ? 'Team' : 'Private'} agent
        </>
      }
      busy={busy()}
      onBack={close}
      onSubmit={() => fireAndForget(submit(pickedLook()), 'agent-settings')}
      contentRef={(element) => {
        pageContentRef = element;
      }}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={close}
            disabled={busy()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="agent-form"
            variant="primary"
            size="lg"
            class="min-w-36"
            disabled={!canCreate()}
          >
            {props.pending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <AgentEditSection
        title="Look"
        description="How it shows up in channels, docs, and tasks."
      >
        {lookFields()}
      </AgentEditSection>
      <AgentEditSection
        title="Name"
        description="Your team mentions it by its @tag, like any teammate."
      >
        {nameFields('row')}
      </AgentEditSection>
      <AgentEditSection
        title="Instructions"
        description="It reads these at the start of every conversation."
      >
        {instructionsField()}
      </AgentEditSection>
      <AgentEditSection
        title="Where it runs"
        description="Where it does its work and which model it uses."
      >
        {whereItRunsFields()}
      </AgentEditSection>
      <AgentEditSection
        title="Who can use it"
        description="Private agents are yours. Team agents work in shared channels."
      >
        {shareFields()}
      </AgentEditSection>
      <AgentEditSection
        title="Channels"
        description="Where people can mention it."
      >
        {channelFields()}
        <div class="mt-6 flex flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="md"
            aria-expanded={advancedOpen()}
            aria-controls="agent-advanced"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            More options
            <CaretDownIcon
              class={cn(
                'size-3.5 touch:size-6 shrink-0 pointer-events-none transition-transform duration-200',
                advancedOpen() && 'rotate-180'
              )}
            />
          </Button>
          <p class="text-xs text-ink-muted">{advancedSummary()}</p>
        </div>
        <Show when={advancedOpen()}>
          <SettingsSurface class="mt-3 p-4">
            {advancedOptions()}
          </SettingsSurface>
        </Show>
      </AgentEditSection>
      <Show when={props.onDelete}>
        {(onDelete) => (
          <AgentEditSection title="Delete agent">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm text-ink-muted">
                Removes it from every channel. This can’t be undone.
              </p>
              <Button
                type="button"
                variant="danger"
                size="md"
                disabled={busy()}
                onClick={onDelete()}
              >
                <TrashIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />{' '}
                Delete agent
              </Button>
            </div>
          </AgentEditSection>
        )}
      </Show>
    </AgentEditFrame>
  );

  const canContinue = (step: WizardStep) =>
    match(step)
      .with('look', () => !uploadingAvatar())
      .with(
        'name',
        () =>
          name().trim().length > 0 &&
          tag().trim().length > 0 &&
          !uploadingAvatar()
      )
      .with('instructions', () => !busy())
      .with(
        'where',
        () =>
          !busy() &&
          selectedHarness() !== undefined &&
          selectedDefaultModelId().length > 0
      )
      .with(
        'share',
        () =>
          !busy() &&
          (mcp().scope === 'owner_connections' ||
            selectedMcpServers().length > 0) &&
          (share() === 'Private'
            ? props.canMakePrivate
            : props.canShareWithTeam)
      )
      .with('channels', () => canCreate())
      .exhaustive();
  const wizard = () => (
    <AgentCreateWizard
      name={name()}
      tag={tag()}
      avatarUrl={avatarUrl()}
      pending={props.pending}
      busy={busy()}
      uploadingAvatar={uploadingAvatar()}
      canContinue={canContinue}
      fields={{
        name: () => nameFields('stack'),
        instructions: instructionsField,
        where: whereItRunsFields,
        share: shareFields,
        channels: channelFields,
        advanced: advancedOptions,
      }}
      advancedSummary={advancedSummary()}
      onUploadAvatar={handleAvatarInput}
      onClearAvatar={() => setAvatarUrl(undefined)}
      onCreate={submit}
      onClose={close}
      onMessage={props.onMessage}
      contentRef={(element) => {
        pageContentRef = element;
      }}
    />
  );

  return (
    <Switch>
      <Match when={setup() === 'cursor'}>
        <CursorConnectPage onClose={finishSetup} />
      </Match>
      <Match when={setup() === 'pairing'}>
        <RuntimePairingPage onClose={finishSetup} />
      </Match>
      <Match when={!setup()}>
        <Show when={props.agent} fallback={wizard()}>
          {editForm()}
        </Show>
      </Match>
    </Switch>
  );
}
