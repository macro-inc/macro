import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import { Button } from '@ui/components/Button';
import { createSignal, For } from 'solid-js';

const MACRO_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      macro: {
        type: 'http',
        url: 'https://mcp-server.macro.com/mcp',
      },
    },
  },
  null,
  2
);

const CLAUDE_CODE_COMMAND =
  'claude mcp add --transport http macro https://mcp-server.macro.com/mcp';

const CODEX_CLI_COMMAND =
  'codex mcp add macro --url https://mcp-server.macro.com/mcp';

const CLI_COMMANDS = [
  {
    key: 'claude-cli',
    label: 'Claude Code',
    command: CLAUDE_CODE_COMMAND,
  },
  {
    key: 'codex-cli',
    label: 'Codex CLI',
    command: CODEX_CLI_COMMAND,
  },
] as const;

export function AiChatEmptyState() {
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        2000
      );
    } catch (err) {
      console.error('Failed to copy MCP setup instructions', err);
    }
  };

  return (
    <div class="w-full p-4 text-ink md:p-5">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <div class="mb-2 inline-flex items-center rounded-xs border border-accent/20 bg-accent/10 px-2 py-1 text-xs text-accent">
              Macro MCP
            </div>
            <h2 class="text-xl leading-tight">Connect AI to Macro</h2>
            <p class="mt-2 max-w-[56ch] text-sm leading-6 text-ink-muted">
              Use macro with your favorite AI chat client or code editor
            </p>
          </div>
        </div>

        <div class="grid gap-3">
          <For each={CLI_COMMANDS}>
            {(item) => (
              <div class="overflow-hidden rounded-md border border-edge-muted bg-input/70">
                <div class="flex items-center justify-between gap-3 border-b border-edge-muted px-4 py-2">
                  <span class="text-sm text-ink-muted">{item.label}</span>
                  <Button
                    variant={copiedKey() === item.key ? 'secondary' : 'ghost'}
                    size="sm"
                    class="shrink-0"
                    onClick={() => handleCopy(item.key, item.command)}
                  >
                    {copiedKey() === item.key ? (
                      <>
                        <CheckIcon class="size-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <ClipboardIcon class="size-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <pre class="overflow-x-auto px-4 py-3 text-[12px] leading-5 text-ink select-text cursor-text whitespace-pre-wrap break-all">
                  <code>{item.command}</code>
                </pre>
              </div>
            )}
          </For>
        </div>

        <div class="overflow-hidden rounded-md border border-edge-muted bg-input/70">
          <div class="flex items-center justify-between gap-3 border-b border-edge-muted px-4 py-2">
            <span class="text-sm text-ink-muted">
              Or configure in your favorite IDE
            </span>
            <div class="flex items-center gap-3">
              <span class="text-xs text-ink-muted">
                Paste under `mcpServers`
              </span>
              <Button
                variant={copiedKey() === 'json' ? 'secondary' : 'ghost'}
                size="sm"
                class="shrink-0"
                onClick={() => handleCopy('json', MACRO_MCP_CONFIG)}
              >
                {copiedKey() === 'json' ? (
                  <>
                    <CheckIcon class="size-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <ClipboardIcon class="size-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
          <pre class="overflow-x-auto px-4 py-4 text-[12px] leading-5 text-ink select-text cursor-text">
            <code>{MACRO_MCP_CONFIG}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
