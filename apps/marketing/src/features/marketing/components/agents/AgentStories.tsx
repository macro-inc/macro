import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Clipboard from '@phosphor/clipboard.svg';
import { Button } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { ProductDemo } from '../product/ProductPage';
import './agent-stories.css';

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

/** Reuse the app’s connection controls without requiring a demo window. */
export function AgentMcpSetup() {
  const [open, setOpen] = createSignal(new Set(['claude-cli']));
  const [copied, setCopied] = createSignal<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const copy = async (key: string, value: string) => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(key);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(undefined), 2000);
  };
  return (
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
                      variant={copied() === card.key ? 'outline' : 'plain'}
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
  );
}

/** Settings → "Macro MCP server" with McpSetupCards; Claude Code open. */
export function AgentMcpDemo() {
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
          <AgentMcpSetup />
        </div>
      </div>
    </ProductDemo>
  );
}
