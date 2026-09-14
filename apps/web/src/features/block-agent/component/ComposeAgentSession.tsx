import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import {
  CURSOR_BOT_HANDLE,
  CURSOR_BOT_ID,
  CURSOR_BOT_NAME,
} from '@core/constant/cursorAgent';
import {
  MACRO_AGENT_HANDLE,
  MACRO_AGENT_NAME,
} from '@core/constant/macroAgent';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { idToDisplayName } from '@core/user/util';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import {
  useAgentSessionControlMutation,
  useCreateAgentSessionMutation,
} from '@queries/agent-session/mutations';
import { useAgentsQuery } from '@queries/agents/agents';
import { useAgentModelsQuery } from '@queries/agents/models';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
} from '@queries/auth/cursor-api-key';
import { useNavigate } from '@solidjs/router';
import {
  Button,
  badgeTriggerClasses,
  cn,
  Dropdown,
  SendButton,
  Surface,
} from '@ui';
import {
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { createRecentAgentSelections } from '../context/recent-agent-selections';
import { AgentPicker } from './AgentPicker';
import {
  agentRuntimeDescription,
  isManagedHarness,
  type ModelOption,
  type ModelShortlist,
  modelPillLabel,
  type PersonaOption,
  personaDefaultLabel,
  shortlistModelOptions,
} from './compose-agent-session-options';

/**
 * Macro's own agent: the deployment's managed default. Sent without a
 * `botId`, so the server picks the runtime it is configured to run it on.
 */
const MACRO_PERSONA_ID = 'macro';

const IN_MEMORY_MODELS: ModelOption[] = Object.values(Model).map((id) => ({
  id,
  name: MODEL_PRETTYNAME[id],
}));

/** The model picker shares the task composer's outline pill look. */
const PILL_CLASS = badgeTriggerClasses({
  variant: 'outline',
  size: 'sm',
  class:
    'max-w-64 gap-1.5 px-2 text-ink-muted data-expanded:bg-hover data-expanded:text-ink',
});

export interface ComposeAgentSessionProps {
  /** Open the new session in a fresh split instead of the current one. */
  preferNewSplit?: boolean;
}

/** Task-style preflight composer for a new managed agent session. */
export function ComposeAgentSession(props: ComposeAgentSessionProps) {
  return (
    <Suspense>
      <ComposeAgentSessionContent {...props} />
    </Suspense>
  );
}

function ComposeAgentSessionContent(props: ComposeAgentSessionProps) {
  const splitPanel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const { openSettings } = useSettingsState();
  const navigate = useNavigate();
  const agentsQuery = useAgentsQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorNeedsConnection = () =>
    cursorStatus.isSuccess &&
    !cursorStatus.isPlaceholderData &&
    !cursorStatus.data.registered;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const macroDefaults = useAgentModelsQuery(() => ({ harness: 'in-memory' }));
  const cursorDefaults = useAgentModelsQuery(
    () => ({ harness: 'cursor' }),
    cursorConnected
  );
  const createSessionMutation = useCreateAgentSessionMutation();
  const controlMutation = useAgentSessionControlMutation();
  const userId = useUserId();
  const recentAgents = createRecentAgentSelections(userId());
  const [prompt, setPrompt] = createSignal('');
  const [personaId, setPersonaId] = createSignal(MACRO_PERSONA_ID);
  const [modelOverride, setModelOverride] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [sessionId, setSessionId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  let appliedModel: string | undefined;
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

  // The two first-party agents lead, then the user's own personas.
  const personas = createMemo<PersonaOption[]>(() => [
    {
      id: MACRO_PERSONA_ID,
      name: MACRO_AGENT_NAME,
      handle: MACRO_AGENT_HANDLE,
      harness: 'in-memory',
      defaultModel: macroDefaults.isSuccess
        ? (macroDefaults.data.currentModel ?? undefined)
        : undefined,
    },
    {
      id: CURSOR_BOT_ID,
      botId: CURSOR_BOT_ID,
      name: CURSOR_BOT_NAME,
      handle: CURSOR_BOT_HANDLE,
      harness: 'cursor',
      defaultModel: cursorStatus.isSuccess
        ? (cursorStatus.data.defaultModelId ??
          (cursorDefaults.isSuccess
            ? (cursorDefaults.data.currentModel ?? undefined)
            : undefined))
        : undefined,
      unavailableReason: cursorConnected()
        ? undefined
        : 'Connect Cursor in Settings → Harness',
      connectLabel: cursorNeedsConnection() ? 'Connect Cursor' : undefined,
    },
    ...(agentsQuery.isSuccess ? agentsQuery.data : [])
      // Only runtimes Macro provisions can be started from here; a persona on
      // a registered macrod daemon opens its own sessions.
      .filter((agent) => isManagedHarness(agent.harness))
      .map((agent) => ({
        id: agent.bot.id,
        botId: agent.bot.id,
        name: agent.bot.name,
        handle: agent.bot.handle,
        description: agent.bot.description ?? undefined,
        avatarUrl: agent.bot.avatar_url ?? undefined,
        harness: agent.harness,
        defaultModel: agent.default_model,
        ownerId:
          agent.bot.owner?.type === 'user'
            ? agent.bot.owner.user_id
            : (agent.bot.created_by ?? undefined),
      })),
  ]);
  const selectedPersona = () =>
    personas().find((persona) => persona.id === personaId()) ?? personas()[0];
  const runtimeDescription = () => {
    const persona = selectedPersona();
    return agentRuntimeDescription(
      persona,
      persona?.harness === 'macrod' && persona.ownerId
        ? idToDisplayName(persona.ownerId)
        : undefined
    );
  };
  const availableModels = (): ModelOption[] => {
    if (selectedPersona()?.harness === 'cursor') {
      return cursorModels.isSuccess
        ? cursorModels.data.models.map((model) => ({
            id: model.id,
            name: model.displayName,
            group: model.group ?? undefined,
          }))
        : [];
    }
    return IN_MEMORY_MODELS;
  };
  const modelShortlist = () =>
    shortlistModelOptions(selectedPersona(), availableModels());
  const modelsForPersona = (persona: PersonaOption): ModelOption[] => {
    const defaults =
      persona.harness === 'cursor' ? cursorDefaults : macroDefaults;
    const models =
      persona.harness === 'cursor'
        ? cursorModels.isSuccess
          ? cursorModels.data.models.map(({ id, displayName }) => ({
              id,
              name: displayName,
            }))
          : []
        : IN_MEMORY_MODELS;
    return defaults.isSuccess
      ? [
          ...models,
          ...defaults.data.models.map(({ id, name }) => ({ id, name })),
        ]
      : models;
  };

  const close = () => splitPanel.handle.close();
  const openCreateAgent = () => {
    if (submitting() || sessionId()) return;
    close();
    navigate('/settings/agents?createAgent=true');
  };
  const connectPersona = (id: string) => {
    if (submitting() || sessionId()) return;
    const persona = personas().find((item) => item.id === id);
    if (persona?.harness !== 'cursor' || !persona.connectLabel) return;
    close();
    openSettings('Harness');
  };
  const setPersona = (id: string) => {
    if (submitting() || sessionId()) return;
    setPersonaId(id);
    setModelOverride('');
  };
  const openSession = (id: string) => {
    close();
    openWithSplit(
      { type: 'agent', id },
      { referredFrom: 'launcher', preferNewSplit: props.preferNewSplit }
    );
  };
  const createSession = async () => {
    const persona = selectedPersona();
    if (submitting() || !persona || persona.unavailableReason) return;
    setSubmitting(true);
    setError(undefined);
    const model = modelOverride();
    const firstPrompt = prompt().trim();
    let id = sessionId();
    let failureMessage =
      'Could not create the agent session. Please try again.';
    try {
      if (!id) {
        const created = await createSessionMutation.mutateAsync({
          ...(persona.botId ? { botId: persona.botId } : {}),
        });
        id = created.session.id;
        // Keep the real session even if a subsequent control request fails.
        // Retrying setup must not create a second session.
        setSessionId(id);
        recentAgents.remember(persona.id);
      }
      if (model && model !== appliedModel) {
        failureMessage =
          'Session created, but the model could not be changed. Retry or open the session.';
        await controlMutation.mutateAsync({
          sessionId: id,
          request: { type: 'setModel', model },
        });
        appliedModel = model;
      }
      if (firstPrompt) {
        failureMessage =
          'Session created, but the prompt could not be sent. Retry or open the session.';
        await controlMutation.mutateAsync({
          sessionId: id,
          request: { type: 'prompt', prompt: firstPrompt },
        });
      }
    } catch (cause) {
      console.error(failureMessage, cause);
      setError(failureMessage);
      return;
    } finally {
      setSubmitting(false);
    }
    openSession(id);
  };

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope(
    'compose-agent-session',
    true
  );
  onMount(() => {
    splitPanel.handle.setDisplayName('New agent session');
    const container = containerRef();
    if (container) attachHotkeys(container);
  });
  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: hotkeyScope,
    description: 'Create agent session',
    keyDownHandler: () => {
      void createSession();
      return true;
    },
    runWithInputFocused: true,
  });

  return (
    <div
      class="portal-scope relative flex max-h-full min-h-0 min-w-0 flex-col overflow-y-auto px-4 pt-8 pb-10 sm:px-9 sm:pt-10 sm:pb-12"
      tabIndex={-1}
      ref={setContainerRef}
      data-agent-session-composer
    >
      <div class="mb-8 shrink-0 text-center">
        <h1 class="text-3xl/9 font-medium text-ink">Start a session</h1>
        <Show when={splitPanel.handle.isPopover()}>
          <Button
            onMouseDown={close}
            tabIndex={-1}
            tooltip="Close"
            size="icon-sm"
            class="absolute top-3 right-3"
          >
            <XIcon />
          </Button>
        </Show>
      </div>

      <Surface
        class="mb-3 flex h-auto shrink-0 items-stretch gap-2 rounded-xl p-1.5"
        depth={1}
        solid
      >
        <div class="min-w-0 flex-1">
          <AgentPicker
            personas={personas()}
            recentIds={recentAgents.ids()}
            selected={selectedPersona()}
            loading={agentsQuery.isPending}
            error={agentsQuery.isError}
            disabled={submitting() || !!sessionId()}
            onSelect={setPersona}
            onConnect={connectPersona}
          />
        </div>
        <Button
          variant="accent"
          size="sm"
          class="h-auto shrink-0 gap-1.5 rounded-lg px-3"
          disabled={submitting() || !!sessionId()}
          onClick={openCreateAgent}
        >
          <PlusIcon class="size-4" />
          Create agent
        </Button>
      </Surface>

      <Surface
        role="group"
        aria-label="New session prompt"
        class="flex h-auto min-h-36 shrink-0 flex-col rounded-xl touch:rounded-2xl"
        depth={1}
        solid
      >
        <textarea
          rows={3}
          aria-label="Task for the agent"
          class="ph-no-capture min-h-20 w-full flex-1 resize-none bg-transparent px-4 pt-4 pb-2 text-sm/6 text-ink outline-none placeholder:text-ink-placeholder touch:text-base"
          placeholder={`What would you like ${selectedPersona()?.name ?? MACRO_AGENT_NAME} to work on?`}
          value={prompt()}
          disabled={submitting()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Escape inside the prompt steps out to the dialog first, matching
            // the task composer; a second Escape closes the popover.
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              containerRef()?.focus();
            }
          }}
        />

        <Show when={error()}>
          {(message) => (
            <div role="alert" class="px-2 text-sm text-negative">
              {message()}
              <Show when={sessionId()}>
                {(id) => (
                  <Button
                    disabled={submitting()}
                    onClick={() => openSession(id())}
                  >
                    Open session
                  </Button>
                )}
              </Show>
            </div>
          )}
        </Show>

        <div class="mt-auto flex shrink-0 items-center justify-between gap-2 px-4 pt-1 pb-3">
          <div class="m-px flex min-h-7 min-w-0 flex-wrap items-center gap-2 text-sm">
            <Suspense>
              <ModelPicker
                persona={selectedPersona()}
                available={modelsForPersona(selectedPersona())}
                shortlist={modelShortlist()}
                value={modelOverride()}
                loading={
                  selectedPersona()?.harness === 'cursor' &&
                  cursorModels.isPending
                }
                disabled={submitting() || !!sessionId()}
                onSelect={setModelOverride}
              />
            </Suspense>
          </div>

          <SendButton
            type="button"
            aria-label={
              submitting() ? 'Starting…' : error() ? 'Retry' : 'Start session'
            }
            tooltip={error() ? 'Retry' : 'Start session'}
            shortcut="cmd+enter"
            pending={submitting()}
            disabled={submitting() || !!selectedPersona()?.unavailableReason}
            onClick={() => void createSession()}
          />
        </div>
      </Surface>
      <p
        aria-live="polite"
        class="mt-7 shrink-0 text-center text-sm text-ink-muted"
      >
        {runtimeDescription()}
      </p>
    </div>
  );
}

function ModelPicker(props: {
  persona: PersonaOption | undefined;
  available: ModelOption[];
  shortlist: ModelShortlist;
  value: string;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const label = () =>
    modelPillLabel(props.value, props.persona, props.available);
  return (
    <Dropdown placement="top-start">
      <Dropdown.Trigger
        variant="outline"
        size="sm"
        class={PILL_CLASS}
        aria-label="Model override"
        disabled={props.disabled}
        tooltip={props.value ? 'Model override' : 'Model (agent default)'}
      >
        <span class={cn('min-w-0 truncate', props.value && 'text-ink')}>
          {label()}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-current/70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
        <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
          <Dropdown.GroupLabel>Model</Dropdown.GroupLabel>
          <ModelRow
            label={personaDefaultLabel(props.persona, props.available)}
            selected={props.value === ''}
            onSelect={() => props.onSelect('')}
          />
          <For each={props.shortlist.featured}>
            {(model) => (
              <ModelRow
                label={model.name}
                selected={props.value === model.id}
                onSelect={() => props.onSelect(model.id)}
              />
            )}
          </For>
          <Show when={props.shortlist.more.length > 0}>
            <Dropdown.Sub>
              <Dropdown.SubTrigger class="h-8">
                <span class="truncate">More models</span>
                <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
                  {props.shortlist.more.length}
                  <CaretRightIcon class="size-3" />
                </span>
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
                <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
                  <For each={props.shortlist.more}>
                    {(model) => (
                      <ModelRow
                        label={model.name}
                        hint={model.group}
                        selected={props.value === model.id}
                        onSelect={() => props.onSelect(model.id)}
                      />
                    )}
                  </For>
                </Dropdown.Group>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Show>
          <Show when={props.loading}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              Loading models…
            </div>
          </Show>
          <Show when={!props.loading && props.available.length === 0}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              This agent's harness did not report any models.
            </div>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function ModelRow(props: {
  label: string;
  /** Trailing muted text, e.g. the family a model belongs to. */
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      class={cn('h-8 gap-2', props.selected && 'bg-ink/5 text-ink font-medium')}
      onSelect={props.onSelect}
    >
      <span class="min-w-0 flex-1 truncate text-sm">{props.label}</span>
      <Show when={props.hint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">{props.hint}</span>
      </Show>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-accent" />
      </Show>
    </Dropdown.Item>
  );
}
