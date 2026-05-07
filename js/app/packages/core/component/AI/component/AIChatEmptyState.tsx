import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import { Button } from '@ui';
import { For } from 'solid-js';
import { CLI_COMMANDS, MACRO_MCP_CONFIG } from './mcpConstants';
import { useClipboardCopy } from './useClipboardCopy';

export function AiChatEmptyState() {
  const { copiedKey, copy } = useClipboardCopy();

  return (
    <div class="w-full p-4 text-ink md:p-5">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <div class="mb-2 inline-flex items-center rounded-xs border border-accent/20 bg-accent/10 px-2 py-1 text-xs text-accent">
              Macro MCP
            </div>
            <h2 class="text-xl/tight">Connect AI to Macro</h2>
            <p class="mt-2 max-w-[56ch] text-sm/6 text-ink-muted">
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
                    variant={copiedKey() === item.key ? 'base' : 'ghost'}
                    size="sm"
                    class="shrink-0"
                    onClick={() => copy(item.key, item.command)}
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
                <pre class="overflow-x-auto px-4 py-3 text-[12px]/5 text-ink select-text cursor-text whitespace-pre-wrap break-all">
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
                variant={copiedKey() === 'json' ? 'base' : 'ghost'}
                size="sm"
                class="shrink-0"
                onClick={() => copy('json', MACRO_MCP_CONFIG)}
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
          <pre class="overflow-x-auto p-4 text-[12px]/5 text-ink select-text cursor-text">
            <code>{MACRO_MCP_CONFIG}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
