import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Clipboard from '@phosphor/clipboard.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import X from '@phosphor/x.svg';
import { Button, cn, Surface } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ViewShell } from '../DemoWorkspaceChrome';
import { InputActionButton } from '../email/frozen/ActionButton';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { ModelCatalogPicker } from '../workspace/frozen/model-picker/ModelCatalogPicker';
import { modelFamilyHint } from '../workspace/frozen/model-picker/modelCatalog';
import { ModelIcon } from '../workspace/frozen/model-picker/ProviderIcon';
import {
  AgentActionLine,
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  AgentThought,
  AgentToolGroup,
  AgentTurn,
} from './AgentTranscript';
import {
  AGENT_MODELS,
  AGENT_PLACEHOLDER,
  meadow,
  northwind,
} from './agentDemoData';
import { createDemoPointer } from './createDemoPointer';
import '../workspace/dummy-workspace.css';
import './agent-stories.css';

/** The production model trigger from agents-view's ModelSelector. */
const MODEL_TRIGGER =
  'h-[33.75px] min-w-0 max-w-full gap-[5.625px] rounded-full border-0 bg-transparent hover:bg-hover px-[7.5px] text-base font-normal text-ink-muted [&_svg]:size-[15px]';

const modelLabel = (id: string) =>
  AGENT_MODELS.find((model) => model.id === id)?.label ?? id;

/** Keep the newest turn in view, as the session transcript does. */
function followLatest(
  log: () => HTMLElement | undefined,
  track: () => unknown
) {
  createEffect(
    on(track, () => {
      const frame = requestAnimationFrame(() => {
        const element = log();
        if (!element) return;
        const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
        element.scrollTo?.({
          top: element.scrollHeight,
          behavior: instant ? 'auto' : 'smooth',
        });
      });
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );
}

/** Topbar, transcript, and ChatComposer of a running agent session. */
function AgentSession(props: {
  title: string;
  model: string;
  onModel: (id: string) => void;
  onSend: (prompt: string) => void;
  log?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  return (
    <>
      <ViewShell.TopBar>
        <span class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
          {props.title}
        </span>
      </ViewShell.TopBar>
      <div
        ref={props.log}
        class="dummy-scroll agent-transcript"
        role="log"
        aria-label={props.title}
      >
        {props.children}
      </div>
      <div class="dummy-composer sample-chat-composer agent-session-composer agent-composer">
        <ChannelComposer
          agent
          label="Message the agent"
          placeholder={AGENT_PLACEHOLDER}
          leadingAction={
            <InputActionButton label="Attach files">
              <Plus />
            </InputActionButton>
          }
          accessory={
            <ModelCatalogPicker
              value={props.model}
              options={AGENT_MODELS}
              onSelect={props.onModel}
              ariaLabel="Model"
              placement="top-end"
              triggerClass={MODEL_TRIGGER}
            />
          }
          onSend={props.onSend}
        />
      </div>
    </>
  );
}

/** Prompts a visitor sends get the scripted reply for that conversation. */
function VisitorTurns(props: {
  turns: string[];
  reply: string;
  mentions: Record<string, AgentMention>;
}) {
  return (
    <For each={props.turns}>
      {(prompt) => (
        <>
          <AgentTurn>
            <AgentPrompt text={prompt} />
          </AgentTurn>
          <AgentTurn>
            <AgentAnswer text={props.reply} mentions={props.mentions} />
          </AgentTurn>
        </>
      )}
    </For>
  );
}

const northwindMentions: Record<string, AgentMention> = {
  valentina: { kind: 'person', person: 'valentina' },
  pricing: { kind: 'email' },
  demo: { kind: 'call', time: 'Tuesday at 2:00 PM' },
};

/** The earlier exchange that opens the Northwind session. */
function NorthwindEarlier() {
  return (
    <>
      <AgentTurn>
        <AgentPrompt text={northwind.earlier.prompt} />
      </AgentTurn>
      <AgentTurn>
        <AgentToolGroup calls={northwind.earlier.calls} />
        <AgentAnswer
          text={northwind.earlier.answer}
          mentions={northwindMentions}
        />
      </AgentTurn>
    </>
  );
}

const MEMORY_STEPS = 9;

/**
 * Who should own a follow-up: the agent thinks, its calls arrive one by one,
 * and the answer streams in with the person, thread, and call it used.
 * Phases: 0 thinking, 1–3 calls, 4 settled, 5–9 the reply streaming.
 */
export function AgentMemoryDemo() {
  let root!: HTMLDivElement;
  let log: HTMLDivElement | undefined;
  const [phase, setPhase] = createSignal(0);
  const [model, setModel] = createSignal(AGENT_MODELS[0].id);
  const [toolsOpen, setToolsOpen] = createSignal(true);
  const [turns, setTurns] = createSignal<string[]>([]);
  const finish = () => setPhase(MEMORY_STEPS);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: MEMORY_STEPS,
    reset: () => {},
    reduced: finish,
    delay: (step) =>
      step === 1 ? 1000 : step <= 3 ? 750 : step === 4 ? 800 : 280,
    advance: setPhase,
  });
  const calls = () =>
    phase() >= 4 ? northwind.calls : northwind.calls.slice(0, phase() + 1);
  const answer = () =>
    northwind.answer.slice(0, Math.max(0, phase() - 3)).join('');
  followLatest(
    () => log,
    () => [phase(), turns().length]
  );
  return (
    <ProductDemo
      ref={(element) => (root = element)}
      label="Ask an agent who should own a customer follow-up"
      onInteract={playback.pause}
      height={520}
      mobileHeight={620}
    >
      <AgentSession
        title={northwind.title}
        model={model()}
        onModel={setModel}
        log={(element) => (log = element)}
        onSend={(prompt) => {
          playback.pause();
          finish();
          setTurns((items) => [...items, prompt]);
        }}
      >
        <NorthwindEarlier />
        <AgentTurn>
          <AgentPrompt text={northwind.prompt} />
        </AgentTurn>
        <AgentTurn>
          <Show
            when={phase() > 0}
            fallback={<AgentThought text={northwind.thought} active />}
          >
            <AgentToolGroup
              calls={calls()}
              active={phase() < 4}
              open={toolsOpen()}
              onOpenChange={setToolsOpen}
            />
          </Show>
          <Show when={answer()}>
            <AgentAnswer text={answer()} mentions={northwindMentions} />
          </Show>
        </AgentTurn>
        <VisitorTurns
          turns={turns()}
          reply={northwind.switchedAnswer}
          mentions={northwindMentions}
        />
      </AgentSession>
    </ProductDemo>
  );
}

const SEARCH_STEPS = 5;

/**
 * One search across the workspace: Jacob opens the Search call's hits (an
 * email, a document, a channel message, and a call), then clicks the cited
 * email, which opens beside the session as a mention does in the app.
 * Phases: 1 point at "4 hits", 2 open them, 3 point at the email, 4 click,
 * 5 the email opens in a split.
 */
export function AgentSearchDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let log: HTMLDivElement | undefined;
  const w = createDummyWorkspace('agents');
  w.setData(
    'documents',
    (doc) => doc.id === 'notes',
    'body',
    '## The Meadow\n\nDana’s team wants email, tasks, and documents in one workspace.\n\n## Open questions\n\n- Seats for the whole team\n- Shared email access\n- Importing their existing docs\n\n## Follow-up\n\nShare the rollout plan. Julia will help with setup. Thursday at 9 works for the follow-up.'
  );
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [hitsOpen, setHitsOpen] = createSignal(false);
  const [item, setItem] = createSignal<WorkspaceView>();
  const [model, setModel] = createSignal(AGENT_MODELS[0].id);
  const [turns, setTurns] = createSignal<string[]>([]);
  const show = (view: WorkspaceView, id: string) => {
    if (view === 'messages') w.setChannel(id);
    w.open(view, id);
    setItem(view);
  };
  const open = (view: WorkspaceView, id: string) => {
    pause();
    show(view, id);
  };
  const mentions: Record<string, AgentMention> = {
    email: { kind: 'email', onOpen: () => open('email', 'dana') },
    rollout: { kind: 'document', onOpen: () => open('documents', 'rollout') },
    notes: { kind: 'document', onOpen: () => open('documents', 'notes') },
    customers: {
      kind: 'channel',
      onOpen: () => open('messages', 'customers'),
    },
  };
  // The cited email opens beside the session where there's room for a split.
  const openSource = () => {
    if (frame.clientWidth >= 640) show('email', 'dana');
  };
  const finish = () => {
    setHitsOpen(true);
    setPhase(SEARCH_STEPS);
    setAutomatic(false);
    openSource();
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: SEARCH_STEPS,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 900, 750, 1300, 800, 350][step] ?? 1000,
    advance: (step) => {
      if (step === 2) setHitsOpen(true);
      if (step === SEARCH_STEPS) finish();
      else setPhase(step);
    },
  });
  function pause() {
    setAutomatic(false);
    playback.pause();
  }
  followLatest(
    () => log,
    () => turns().length
  );
  const pointer = createDemoPointer({
    frame: () => frame,
    target: () =>
      automatic()
        ? [
            undefined,
            '[data-search-toggle]',
            '[data-search-toggle]',
            '[data-agent-mention="email"]',
            '[data-agent-mention="email"]',
          ][phase()]
        : undefined,
  });
  return (
    <div ref={root} class="agent-demo-flow">
      <div ref={frame} class="agent-demo-frame" onFocusIn={pause}>
        <ProductDemo
          label="One search across email, documents, channels, and calls"
          onInteract={pause}
          height={680}
          mobileHeight={760}
        >
          <div class="agent-split" data-item-open={item() ? 'true' : undefined}>
            <div class="agent-split-pane">
              <AgentSession
                title={meadow.title}
                model={model()}
                onModel={setModel}
                log={(element) => (log = element)}
                onSend={(prompt) => {
                  pause();
                  setTurns((items) => [...items, prompt]);
                }}
              >
                <AgentTurn>
                  <AgentPrompt text={meadow.prompt} />
                </AgentTurn>
                <AgentTurn>
                  <AgentToolGroup
                    calls={meadow.calls}
                    defaultOpen
                    searchOpen={hitsOpen()}
                    onSearchOpenChange={(value) => {
                      pause();
                      setHitsOpen(value);
                    }}
                  />
                  <AgentAnswer text={meadow.answer} mentions={mentions} />
                </AgentTurn>
                <VisitorTurns
                  turns={turns()}
                  reply={meadow.followUp}
                  mentions={mentions}
                />
              </AgentSession>
            </div>
            <Show when={item()}>
              <section
                class="agent-split-pane agent-split-item"
                aria-label="Opened item"
              >
                <ProductWorkspace workspace={w} />
                <Button
                  variant="plain"
                  size="icon-sm"
                  class="agent-split-close"
                  label="Close"
                  onClick={() => setItem(undefined)}
                >
                  <X class="size-4" />
                </Button>
              </section>
            </Show>
          </div>
        </ProductDemo>
        <Show when={pointer()}>
          {(p) => (
            <DemoCursor
              label="Jacob"
              class="agent-demo-pointer"
              clicking={phase() === 2 || phase() === 4}
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

const ROW =
  'group rounded-lg w-full flex items-center gap-1.5 p-1.5 px-2 text-left font-normal cursor-default outline-none data-highlighted:bg-ink/5';

/**
 * The open ModelCatalogPicker as the walkthrough shows it. A still frame of
 * the menu, so the scripted click never moves focus or locks page scroll;
 * the real picker in the composer stays fully interactive.
 */
function ModelMenuFrame(props: {
  value: string;
  highlighted?: string;
  style: JSX.CSSProperties;
}) {
  return (
    <div class="agent-model-menu" style={props.style} aria-hidden="true">
      <Surface
        depth={2}
        hideBorder
        class="menu-surface rounded-xl size-auto text-sm w-full menu-open-animation"
      >
        <div class="flex flex-col divide-y divide-edge-divider size-full">
          <div class="bg-menu p-1.5">
            <div class="flex items-center gap-2 px-2">
              <MagnifyingGlass class="size-4 shrink-0 text-ink-extra-muted" />
              <span class="min-w-0 w-full py-2 text-sm text-ink-extra-muted">
                Search models
              </span>
            </div>
          </div>
          <div class="flex flex-col p-1.5 bg-menu">
            <div class="px-2 h-7 flex items-center text-xs text-ink-extra-muted">
              Recommended
            </div>
            <For each={AGENT_MODELS}>
              {(option) => (
                <div
                  data-model-option={option.id}
                  data-highlighted={
                    props.highlighted === option.id ? '' : undefined
                  }
                  class={cn(
                    ROW,
                    'h-8 gap-2',
                    option.id === props.value && 'bg-ink/5 text-ink font-medium'
                  )}
                >
                  <ModelIcon model={option.id} />
                  <span class="min-w-0 flex-1 truncate text-sm">
                    {option.label}
                  </span>
                  <Show when={modelFamilyHint(option)}>
                    {(hint) => (
                      <span class="shrink-0 text-xs text-ink-extra-muted">
                        {hint()}
                      </span>
                    )}
                  </Show>
                  <Show when={option.id === props.value}>
                    <Check class="size-3.5 shrink-0 text-accent" />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Surface>
    </div>
  );
}

const MODEL_STEPS = 7;
const SWITCH_TO = 'gpt-5.6';

/**
 * The same session after a model switch: Jacob picks GPT-5.6 in the
 * composer and asks again; the answer comes from the same memory and tools.
 * Phases: 1 point at the picker, 2 open it, 3 point at GPT-5.6, 4 select,
 * 5 the prompt, 6 the calls, 7 the answer.
 */
export function AgentModelsDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let log: HTMLDivElement | undefined;
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [model, setModel] = createSignal(AGENT_MODELS[0].id);
  const [switched, setSwitched] = createSignal<string>();
  const [menu, setMenu] = createSignal<JSX.CSSProperties>();
  const [turns, setTurns] = createSignal<string[]>([]);
  const select = (id: string) => {
    if (id === model()) return;
    setModel(id);
    setSwitched(id);
  };
  const finish = () => {
    select(SWITCH_TO);
    setPhase(MODEL_STEPS);
    setAutomatic(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: MODEL_STEPS,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 900, 700, 800, 700, 700, 700, 900][step] ?? 800,
    advance: (step) => {
      if (step === 4) {
        select(SWITCH_TO);
        setAutomatic(false);
      }
      setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => frame,
    target: () =>
      automatic()
        ? [
            undefined,
            '[aria-label="Model"]',
            '[aria-label="Model"]',
            `[data-model-option="${SWITCH_TO}"]`,
          ][phase()]
        : undefined,
  });
  // Anchor the menu frame where Kobalte places the picker: top-end, 4px gutter.
  createEffect(() => {
    if (!automatic() || phase() < 2 || phase() > 3) {
      setMenu(undefined);
      return;
    }
    const trigger = frame.querySelector<HTMLElement>('[aria-label="Model"]');
    const stage = trigger?.closest<HTMLElement>('.dummy-main');
    if (!trigger || !stage) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = stage.getBoundingClientRect();
    // Kobalte shifts the menu to stay inside the viewport on narrow screens.
    const width = Math.min(288, bounds.width - 16);
    const left = Math.max(
      8,
      Math.min(anchor.right - bounds.left - width, bounds.width - width - 8)
    );
    setMenu({
      left: `${left}px`,
      width: `${width}px`,
      bottom: `${bounds.bottom - anchor.top + 4}px`,
    });
  });
  followLatest(
    () => log,
    () => [phase(), turns().length]
  );
  return (
    <div ref={root} class="agent-demo-flow">
      <div ref={frame} class="agent-demo-frame" onFocusIn={pause}>
        <ProductDemo
          label="Switch models in the same agent session"
          onInteract={pause}
          height={540}
          mobileHeight={640}
        >
          <AgentSession
            title={northwind.title}
            model={model()}
            onModel={(id) => {
              pause();
              select(id);
            }}
            log={(element) => (log = element)}
            onSend={(prompt) => {
              pause();
              setTurns((items) => [...items, prompt]);
            }}
          >
            <NorthwindEarlier />
            <AgentTurn>
              <AgentPrompt text={northwind.prompt} />
            </AgentTurn>
            <AgentTurn>
              <AgentToolGroup calls={northwind.calls} />
              <AgentAnswer
                text={northwind.answer.join('')}
                mentions={northwindMentions}
              />
            </AgentTurn>
            <Show when={switched()}>
              {(id) => (
                <AgentTurn>
                  <AgentActionLine label={`Model set to ${modelLabel(id())}`} />
                </AgentTurn>
              )}
            </Show>
            <Show when={phase() >= 5}>
              <AgentTurn>
                <AgentPrompt text={northwind.prompt} />
              </AgentTurn>
              <AgentTurn>
                <Show when={phase() >= 6}>
                  <AgentToolGroup
                    calls={northwind.switchedCalls}
                    active={phase() < 7}
                    open={phase() < 7 ? true : undefined}
                  />
                </Show>
                <Show when={phase() >= 7}>
                  <AgentAnswer
                    text={northwind.switchedAnswer}
                    mentions={northwindMentions}
                  />
                </Show>
              </AgentTurn>
            </Show>
            <VisitorTurns
              turns={turns()}
              reply={northwind.switchedAnswer}
              mentions={northwindMentions}
            />
          </AgentSession>
          <Show when={menu()}>
            {(style) => (
              <ModelMenuFrame
                value={model()}
                highlighted={phase() === 3 ? SWITCH_TO : undefined}
                style={style()}
              />
            )}
          </Show>
        </ProductDemo>
        <Show when={pointer()}>
          {(p) => (
            <DemoCursor
              label="Jacob"
              class="agent-demo-pointer"
              clicking={phase() === 2}
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

const MCP_URL = 'https://mcp-server.macro.com/mcp';
const MCP_CONFIG = JSON.stringify(
  { mcpServers: { macro: { type: 'http', url: MCP_URL } } },
  null,
  2
);
/** mcpConstants: the same cards, labels, and commands as Settings. */
const MCP_CARDS = [
  {
    key: 'claude-cli',
    label: 'Claude Code',
    value: `claude mcp add --transport http macro ${MCP_URL}`,
  },
  {
    key: 'codex-cli',
    label: 'Codex CLI',
    value: `codex mcp add macro --url ${MCP_URL}`,
  },
  {
    key: 'claude-web',
    label: 'Claude.ai',
    hint: 'Settings → Connectors → Add custom connector',
    value: MCP_URL,
  },
  {
    key: 'chatgpt-web',
    label: 'ChatGPT',
    hint: 'Settings → Apps → Advanced settings → enable Developer mode, then Create App',
    value: MCP_URL,
  },
  { key: 'json', label: 'IDE', value: MCP_CONFIG },
];

/** Settings → "Macro MCP server" with McpSetupCards; Claude Code open. */
export function AgentMcpDemo() {
  const [open, setOpen] = createSignal(new Set(['claude-cli']));
  const [copied, setCopied] = createSignal<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const copy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(key);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(undefined), 2000);
  };
  return (
    <ProductDemo
      label="Connect an MCP client to Macro"
      height={420}
      mobileHeight={500}
    >
      <div class="dummy-scroll">
        <div class="agent-mcp-page">
          <header class="agent-mcp-header">
            <span class="text-2xl/tight font-semibold text-ink">
              Macro MCP server
            </span>
            <p class="text-sm text-ink-muted">
              Connect other agents and tools to your Macro workspace.
            </p>
          </header>
          <div class="agent-mcp-cards">
            <For each={MCP_CARDS}>
              {(card) => {
                const expanded = () => open().has(card.key);
                return (
                  <div class="overflow-hidden rounded-md border border-edge-muted bg-surface/70">
                    <button
                      type="button"
                      class="flex items-center gap-2 w-full px-4 py-2 text-left"
                      aria-expanded={expanded()}
                      onClick={() =>
                        setOpen((keys) => {
                          const next = new Set(keys);
                          if (next.has(card.key)) next.delete(card.key);
                          else next.add(card.key);
                          return next;
                        })
                      }
                    >
                      <CaretRight
                        aria-hidden="true"
                        class={`size-3 shrink-0 text-ink-muted transition-transform ${expanded() ? 'rotate-90' : ''}`}
                      />
                      <span class="text-sm text-ink-muted truncate">
                        {card.label}
                      </span>
                    </button>
                    <Show when={expanded()}>
                      <div class="border-t border-edge-muted flex flex-col">
                        <Show when={card.hint}>
                          <div class="px-4 pt-3 text-xs text-ink-extra-muted">
                            {card.hint}
                          </div>
                        </Show>
                        <div class="flex items-start justify-between gap-3 px-4 py-3">
                          <pre class="flex-1 min-w-0 overflow-x-auto text-[12px]/5 text-ink select-text cursor-text whitespace-pre-wrap break-all">
                            <code>{card.value}</code>
                          </pre>
                          <Button
                            variant={
                              copied() === card.key ? 'outline' : 'plain'
                            }
                            size="sm"
                            class="shrink-0"
                            onClick={() => copy(card.key, card.value)}
                          >
                            <Show
                              when={copied() === card.key}
                              fallback={
                                <>
                                  <Clipboard class="size-3.5" />
                                  Copy
                                </>
                              }
                            >
                              <Check class="size-3.5" />
                              Copied
                            </Show>
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </ProductDemo>
  );
}
