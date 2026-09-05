import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { MACRO_CODER_NAME } from '@core/constant/macroCoder';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import RobotIcon from '@phosphor/robot.svg';
import XIcon from '@phosphor/x.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
} from '@queries/auth/cursor-api-key';
import { Avatar, Button, Hotkey } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { startPendingSession } from '../context/pending-session';

const DEFAULT_PERSONA_ID = 'macro-coder';

type PersonaOption = {
  id: string;
  botId?: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  harness: string;
  defaultModel?: string;
};

type ModelOption = {
  id: string;
  name: string;
};

const IN_MEMORY_MODELS: ModelOption[] = Object.values(Model).map((id) => ({
  id,
  name: MODEL_PRETTYNAME[id],
}));

/** Task-style preflight composer for a new managed agent session. */
export function ComposeAgentSession() {
  const splitPanel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const agentsQuery = useAgentsQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const [prompt, setPrompt] = createSignal('');
  const [personaId, setPersonaId] = createSignal(DEFAULT_PERSONA_ID);
  const [modelOverride, setModelOverride] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

  const personas = (): PersonaOption[] => [
    {
      id: DEFAULT_PERSONA_ID,
      name: MACRO_CODER_NAME,
      handle: 'coder',
      harness: 'sandbox',
    },
    ...(agentsQuery.isSuccess ? agentsQuery.data : [])
      // A connected macrod owns its workspace and starts sessions itself.
      // The create composer can only provision runtimes managed by Macro.
      .filter((agent) => agent.harness !== 'macrod')
      .map((agent) => ({
        id: agent.bot.id,
        botId: agent.bot.id,
        name: agent.bot.name,
        handle: agent.bot.handle,
        avatarUrl: agent.bot.avatar_url ?? undefined,
        harness: agent.harness,
        defaultModel: agent.default_model,
      })),
  ];
  const selectedPersona = () =>
    personas().find((persona) => persona.id === personaId()) ?? personas()[0];
  const availableModels = (): ModelOption[] => {
    if (selectedPersona()?.harness === 'cursor') {
      return cursorModels.isSuccess
        ? cursorModels.data.models.map((model) => ({
            id: model.id,
            name: model.displayName,
          }))
        : [];
    }
    return IN_MEMORY_MODELS;
  };
  const overrideModels = () => {
    const defaultModel = selectedPersona()?.defaultModel;
    return defaultModel
      ? availableModels().filter((model) => model.id !== defaultModel)
      : availableModels();
  };
  const defaultModelLabel = () => {
    const defaultModel = selectedPersona()?.defaultModel;
    if (!defaultModel) return 'Persona default';
    const label =
      availableModels().find((model) => model.id === defaultModel)?.name ??
      defaultModel;
    return `Persona default · ${label}`;
  };

  const close = () => splitPanel.handle.close();
  const setPersona = (id: string) => {
    setPersonaId(id);
    setModelOverride('');
  };
  const createSession = () => {
    if (submitting()) return;
    setSubmitting(true);
    const persona = selectedPersona();
    const placeholder = startPendingSession({
      botId: persona?.botId,
      prompt: prompt().trim() || undefined,
      modelOverride: modelOverride() || undefined,
    });
    close();
    openWithSplit(
      { type: 'agent', id: placeholder },
      { referredFrom: 'launcher' }
    );
  };

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope(
    'compose-agent-session',
    true
  );
  onMount(() => {
    const container = containerRef();
    if (container) attachHotkeys(container);
  });
  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: hotkeyScope,
    description: 'Create agent session',
    keyDownHandler: () => {
      createSession();
      return true;
    },
    runWithInputFocused: true,
  });

  return (
    <div
      class="flex h-full min-h-0 flex-col gap-4 p-4"
      tabIndex={-1}
      ref={setContainerRef}
      data-agent-session-composer
    >
      <div class="flex items-center justify-end">
        <Button
          type="button"
          size="icon-sm"
          tooltip="Close"
          onMouseDown={close}
        >
          <XIcon />
        </Button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 px-2">
        <textarea
          autofocus
          rows={6}
          class="ph-no-capture min-h-32 w-full flex-1 resize-none bg-transparent text-xl/7 font-medium text-ink outline-none placeholder:text-ink-placeholder"
          placeholder="What should the agent work on?"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
        />

        <div class="flex flex-wrap items-center gap-2">
          <label class="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-edge-muted bg-surface-2 px-2.5 py-2">
            <PersonaAvatar persona={selectedPersona()} />
            <span class="min-w-0 flex-1">
              <span class="block text-xxs font-medium uppercase text-ink-extra-muted">
                Persona
              </span>
              <select
                aria-label="Persona"
                class="w-full bg-transparent text-sm font-medium text-ink outline-none"
                value={personaId()}
                onChange={(event) => setPersona(event.currentTarget.value)}
              >
                <For each={personas()}>
                  {(persona) => (
                    <option value={persona.id}>
                      {persona.name} · @{persona.handle}
                    </option>
                  )}
                </For>
              </select>
            </span>
          </label>

          <label class="flex min-w-48 flex-1 flex-col rounded-lg border border-edge-muted bg-surface-2 px-2.5 py-2">
            <span class="text-xxs font-medium uppercase text-ink-extra-muted">
              Model
            </span>
            <select
              aria-label="Model override"
              class="w-full bg-transparent text-sm font-medium text-ink outline-none"
              value={modelOverride()}
              onChange={(event) => setModelOverride(event.currentTarget.value)}
            >
              <option value="">{defaultModelLabel()}</option>
              <For each={overrideModels()}>
                {(model) => <option value={model.id}>{model.name}</option>}
              </For>
            </select>
          </label>
        </div>

        <Show when={agentsQuery.isError}>
          <p class="text-xs text-negative">
            Your saved personas could not be loaded. You can still start with
            Macro Coder.
          </p>
        </Show>
      </div>

      <div class="flex shrink-0 justify-end">
        <Button
          type="button"
          variant="accent"
          depth={3}
          class="gap-3 rounded-lg border-0"
          disabled={submitting()}
          onClick={createSession}
        >
          {submitting() ? 'Creating…' : 'Create Session'}
          <Hotkey shortcut="cmd+enter" theme="current" />
        </Button>
      </div>
    </div>
  );
}

function PersonaAvatar(props: { persona?: PersonaOption }) {
  return (
    <Avatar size="sm" class="shrink-0 bg-surface text-accent">
      <Show
        when={props.persona?.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <RobotIcon />
          </Avatar.Fallback>
        }
      >
        {(avatarUrl) => (
          <Avatar.Image
            src={avatarUrl()}
            alt={`${props.persona?.name ?? 'Agent'} avatar`}
          />
        )}
      </Show>
    </Avatar>
  );
}
