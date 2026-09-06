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
import { Avatar, Button, badgeTriggerClasses, cn, Dropdown, Hotkey } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { startPendingSession } from '../context/pending-session';
import {
  harnessDisplayName,
  isManagedHarness,
  type ModelOption,
  type ModelShortlist,
  modelPillLabel,
  type PersonaOption,
  personaDefaultLabel,
  shortlistModelOptions,
  visiblePersonas,
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
    'max-w-64 gap-1.5 pl-1.5 pr-2 text-ink-muted data-expanded:bg-hover data-expanded:text-ink',
});

/** Long harness catalogs scroll instead of growing the menu without bound. */
const MENU_LIST_CLASS = 'max-h-72 overflow-y-auto overscroll-contain';

export interface ComposeAgentSessionProps {
  /** Open the new session in a fresh split instead of the current one. */
  preferNewSplit?: boolean;
}

/** Task-style preflight composer for a new managed agent session. */
export function ComposeAgentSession(props: ComposeAgentSessionProps) {
  const splitPanel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const agentsQuery = useAgentsQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const [prompt, setPrompt] = createSignal('');
  const [personaId, setPersonaId] = createSignal(MACRO_PERSONA_ID);
  const [personasExpanded, setPersonasExpanded] = createSignal(false);
  const [modelOverride, setModelOverride] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  let promptRef: HTMLTextAreaElement | undefined;

  // The two first-party coders lead, then the user's own personas.
  const personas = (): PersonaOption[] => [
    {
      id: MACRO_PERSONA_ID,
      name: MACRO_AGENT_NAME,
      handle: MACRO_AGENT_HANDLE,
      harness: 'in-memory',
    },
    {
      id: CURSOR_BOT_ID,
      botId: CURSOR_BOT_ID,
      name: CURSOR_BOT_NAME,
      handle: CURSOR_BOT_HANDLE,
      harness: 'cursor',
      defaultModel: cursorStatus.data?.defaultModelId ?? undefined,
      unavailableReason: cursorConnected()
        ? undefined
        : 'Connect Cursor in Settings → Harness',
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
        avatarUrl: agent.bot.avatar_url ?? undefined,
        harness: agent.harness,
        defaultModel: agent.default_model,
      })),
  ];
  const selectedPersona = () =>
    personas().find((persona) => persona.id === personaId()) ?? personas()[0];
  const personaList = () =>
    visiblePersonas(personas(), selectedPersona()?.id, personasExpanded());
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
      { referredFrom: 'launcher', preferNewSplit: props.preferNewSplit }
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
          rows={4}
          aria-label="Task for the agent"
          class="ph-no-capture min-h-24 w-full grow resize-none bg-transparent px-2 text-xl/7 font-medium text-ink outline-none placeholder:text-ink-placeholder"
          placeholder="Give your agent a prompt..."
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

      <PersonaList
        list={personaList()}
        selected={selectedPersona()}
        expanded={personasExpanded()}
        loading={agentsQuery.isPending}
        error={agentsQuery.isError}
        onSelect={setPersona}
        onToggleExpanded={() => setPersonasExpanded((value) => !value)}
      />

      <div class="flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div class="m-px flex min-h-7 flex-wrap items-center gap-2 text-sm">
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

/**
 * Personas as a visible radio list rather than a menu: the user sees what
 * they are choosing between without opening anything. Arrow keys move the
 * selection; Tab lands on the current choice and moves on.
 */
function PersonaList(props: {
  list: { visible: PersonaOption[]; hiddenCount: number };
  selected: PersonaOption | undefined;
  expanded: boolean;
  loading: boolean;
  error: boolean;
  onSelect: (id: string) => void;
  onToggleExpanded: () => void;
}) {
  let groupRef: HTMLDivElement | undefined;
  const selectable = () =>
    props.list.visible.filter((persona) => !persona.unavailableReason);

  const moveSelection = (event: KeyboardEvent, step: 1 | -1) => {
    const options = selectable();
    const index = options.findIndex(
      (persona) => persona.id === props.selected?.id
    );
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    event.preventDefault();
    props.onSelect(next.id);
    queueMicrotask(() => {
      groupRef
        ?.querySelector<HTMLElement>(`[data-persona-id="${next.id}"]`)
        ?.focus();
    });
  };

  return (
    <section class="flex shrink-0 flex-col gap-2 px-2" aria-label="Agent">
      <div class="flex items-center justify-between text-xxs font-medium uppercase text-ink-extra-muted">
        <span>Agent</span>
        <Show when={props.loading}>
          <span class="normal-case">Loading yours…</span>
        </Show>
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Agent"
        class="flex flex-wrap gap-2"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            moveSelection(event, 1);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            moveSelection(event, -1);
          }
        }}
      >
        <For each={props.list.visible}>
          {(persona) => {
            const selected = () => persona.id === props.selected?.id;
            const disabled = () => persona.unavailableReason !== undefined;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected()}
                aria-disabled={disabled()}
                data-persona-id={persona.id}
                tabIndex={selected() ? 0 : -1}
                title={persona.unavailableReason}
                class={cn(
                  'flex h-11 min-w-0 max-w-56 items-center gap-2 rounded-lg border px-2 text-left outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-accent/30',
                  selected()
                    ? 'border-accent bg-accent-bg text-ink'
                    : 'border-edge-muted bg-surface-2 text-ink-muted hover:bg-hover hover:text-ink',
                  disabled() &&
                    'cursor-not-allowed opacity-50 hover:bg-surface-2'
                )}
                onClick={() => {
                  if (!disabled()) props.onSelect(persona.id);
                }}
              >
                <PersonaAvatar persona={persona} />
                <span class="flex min-w-0 flex-col leading-tight">
                  <span class="truncate text-sm font-medium">
                    {persona.name}
                  </span>
                  <span class="truncate text-xs text-ink-extra-muted">
                    @{persona.handle}
                    <Show when={!disabled()}>
                      {' · '}
                      {harnessDisplayName(persona.harness)}
                    </Show>
                    <Show when={disabled()}>
                      {' · '}
                      {persona.unavailableReason}
                    </Show>
                  </span>
                </span>
                {/* Always laid out so selecting a card never changes its width. */}
                <CheckIcon
                  class={cn(
                    'ml-auto size-3.5 shrink-0 text-accent',
                    !selected() && 'invisible'
                  )}
                />
              </button>
            );
          }}
        </For>
        <Show when={props.list.hiddenCount > 0 || props.expanded}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-11 rounded-lg px-3 text-ink-muted"
            onClick={props.onToggleExpanded}
          >
            {props.expanded ? 'Show fewer' : `+${props.list.hiddenCount} more`}
          </Button>
        </Show>
      </div>
      <Show when={props.error}>
        <p class="text-xs text-negative">
          Your saved agents could not be loaded. You can still start with{' '}
          {MACRO_AGENT_NAME} or {CURSOR_BOT_NAME}.
        </p>
      </Show>
    </section>
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
        tooltip={props.value ? 'Model override' : 'Model (agent default)'}
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

function PersonaAvatar(props: { persona: PersonaOption }) {
  return (
    <Avatar size="md" class="shrink-0 bg-surface text-accent">
      <Show
        when={props.persona.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <RobotIcon class="size-4" />
          </Avatar.Fallback>
        }
      >
        {(avatarUrl) => (
          <Avatar.Image
            src={avatarUrl()}
            alt={`${props.persona.name} avatar`}
          />
        )}
      </Show>
    </Avatar>
  );
}
