import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { CURSOR_BOT_HANDLE, CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_HANDLE } from '@core/constant/macroCoder';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CpuIcon from '@phosphor/cpu.svg';
import RobotIcon from '@phosphor/robot.svg';
import XIcon from '@phosphor/x.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  useCursorApiKeyStatusQuery,
  useCursorModelsQuery,
} from '@queries/auth/cursor-api-key';
import { Avatar, badgeTriggerClasses, Button, cn, Dropdown, Hotkey } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { startPendingSession } from '../context/pending-session';
import {
  harnessDisplayName,
  type ModelOption,
  type ModelShortlist,
  modelPillLabel,
  type PersonaOption,
  personaDefaultLabel,
  shortlistModelOptions,
} from './compose-agent-session-options';

/**
 * The deployment's default coder. Sent without a `botId`, so the server picks
 * its managed default persona.
 */
const MACRO_AGENT_PERSONA_ID = 'macro-agent';
const MACRO_AGENT_NAME = 'Macro Agent';
const CURSOR_CODER_NAME = 'Cursor Coder';

const IN_MEMORY_MODELS: ModelOption[] = Object.values(Model).map((id) => ({
  id,
  name: MODEL_PRETTYNAME[id],
}));

/** Bottom-of-dialog pickers share the task composer's outline pill look. */
const PILL_CLASS = badgeTriggerClasses({
  variant: 'outline',
  size: 'sm',
  class:
    'max-w-64 gap-1.5 pl-1.5 pr-2 text-ink-muted data-expanded:bg-hover data-expanded:text-ink',
});

/** Long harness catalogs scroll instead of growing the menu without bound. */
const MENU_LIST_CLASS = 'max-h-72 overflow-y-auto overscroll-contain';

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
  const [personaId, setPersonaId] = createSignal(MACRO_AGENT_PERSONA_ID);
  const [modelOverride, setModelOverride] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  let promptRef: HTMLTextAreaElement | undefined;

  // Built-in coders lead, then the user's own personas.
  const personas = (): PersonaOption[] => [
    {
      id: MACRO_AGENT_PERSONA_ID,
      name: MACRO_AGENT_NAME,
      handle: MACRO_CODER_HANDLE,
      harness: 'sandbox',
    },
    {
      id: CURSOR_BOT_ID,
      botId: CURSOR_BOT_ID,
      name: CURSOR_CODER_NAME,
      handle: CURSOR_BOT_HANDLE,
      harness: 'cursor',
      defaultModel: cursorStatus.data?.defaultModelId ?? undefined,
      unavailableReason: cursorConnected()
        ? undefined
        : 'Connect Cursor in Settings → Harness',
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
            group: model.group ?? undefined,
          }))
        : [];
    }
    return IN_MEMORY_MODELS;
  };
  const modelShortlist = () =>
    shortlistModelOptions(selectedPersona(), availableModels());

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
    // The dialog's focus scope lands on its first focusable child once the
    // popover has mounted; take the prompt after that so typing can start
    // immediately.
    requestAnimationFrame(() => promptRef?.focus());
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
      class="portal-scope relative flex h-full max-h-full min-h-0 flex-col gap-4 p-4"
      tabIndex={-1}
      ref={setContainerRef}
      data-agent-session-composer
    >
      <div class="flex items-center gap-1">
        <div class="flex flex-1 items-center gap-2 px-2 text-xs font-medium text-ink-extra-muted">
          <RobotIcon class="size-3.5" />
          New agent session
        </div>
        <Show when={splitPanel.handle.isPopover()}>
          <Button
            onMouseDown={close}
            tabIndex={-1}
            tooltip="Close"
            size="icon-sm"
          >
            <XIcon />
          </Button>
        </Show>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <textarea
          ref={promptRef}
          rows={5}
          aria-label="Task for the agent"
          class="ph-no-capture min-h-28 w-full grow resize-none bg-transparent px-2 text-xl/7 font-medium text-ink outline-none placeholder:text-ink-placeholder"
          placeholder="What should the agent work on?"
          value={prompt()}
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
      </div>

      <Show when={agentsQuery.isError}>
        <p class="px-2 text-xs text-negative">
          Your saved personas could not be loaded. You can still start with{' '}
          {MACRO_AGENT_NAME}.
        </p>
      </Show>

      <div class="flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div class="m-px flex min-h-7 flex-wrap items-center gap-2 text-sm">
          <PersonaPicker
            personas={personas()}
            selected={selectedPersona()}
            loading={agentsQuery.isPending}
            onSelect={setPersona}
          />
          <ModelPicker
            persona={selectedPersona()}
            available={availableModels()}
            shortlist={modelShortlist()}
            value={modelOverride()}
            loading={
              selectedPersona()?.harness === 'cursor' && cursorModels.isPending
            }
            onSelect={setModelOverride}
          />
        </div>

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

function PersonaPicker(props: {
  personas: PersonaOption[];
  selected: PersonaOption | undefined;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Dropdown placement="top-start">
      <Dropdown.Trigger
        variant="outline"
        size="sm"
        class={PILL_CLASS}
        aria-label="Persona"
        tooltip="Persona"
      >
        <PersonaAvatar persona={props.selected} size="xs" />
        <span class="min-w-0 truncate text-ink">{props.selected?.name}</span>
        <CaretDownIcon class="size-3 shrink-0 text-current/70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
        <Dropdown.Group class={MENU_LIST_CLASS}>
          <Dropdown.GroupLabel>Persona</Dropdown.GroupLabel>
          <For each={props.personas}>
            {(persona) => (
              <Dropdown.Item
                class={cn(
                  'h-10 gap-2.5',
                  persona.id === props.selected?.id && 'bg-ink/5 text-ink'
                )}
                disabled={persona.unavailableReason !== undefined}
                title={persona.unavailableReason}
                onSelect={() => props.onSelect(persona.id)}
              >
                <PersonaAvatar persona={persona} size="sm" />
                <span class="flex min-w-0 flex-1 flex-col leading-tight">
                  <span
                    class={cn(
                      'truncate text-sm',
                      persona.id === props.selected?.id && 'font-medium'
                    )}
                  >
                    {persona.name}
                  </span>
                  <span class="truncate text-xs text-ink-extra-muted">
                    @{persona.handle} ·{' '}
                    {persona.unavailableReason ??
                      harnessDisplayName(persona.harness)}
                  </span>
                </span>
                <Show when={persona.id === props.selected?.id}>
                  <CheckIcon class="size-3.5 shrink-0 text-accent" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
          <Show when={props.loading}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              Loading your personas…
            </div>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function ModelPicker(props: {
  persona: PersonaOption | undefined;
  available: ModelOption[];
  shortlist: ModelShortlist;
  value: string;
  loading: boolean;
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
        tooltip={props.value ? 'Model override' : 'Model (persona default)'}
      >
        <CpuIcon class="size-3.5 shrink-0" />
        <span class={cn('min-w-0 truncate', props.value && 'text-ink')}>
          {label()}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-current/70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
        <Dropdown.Group class={MENU_LIST_CLASS}>
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
                <Dropdown.Group class={MENU_LIST_CLASS}>
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
              This persona's harness did not report any models.
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

function PersonaAvatar(props: { persona?: PersonaOption; size: 'xs' | 'sm' }) {
  return (
    <Avatar
      size={props.size === 'xs' ? 'sm' : 'md'}
      class={cn(
        'shrink-0 bg-surface text-accent',
        props.size === 'xs' && 'size-4 text-[10px]'
      )}
    >
      <Show
        when={props.persona?.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <RobotIcon class={props.size === 'xs' ? 'size-3' : 'size-4'} />
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
