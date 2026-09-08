import {
  CLI_COMMANDS,
  MACRO_MCP_CONFIG,
  MACRO_MCP_URL,
  WEB_CLIENTS,
} from '@core/component/AI/component/mcpConstants';
import { useClipboardCopy } from '@core/component/AI/component/useClipboardCopy';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Code from '@phosphor/code.svg';
import Copy from '@phosphor/copy.svg';
import Globe from '@phosphor/globe.svg';
import Terminal from '@phosphor/terminal-window.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  ManagementCard,
  ManagementEditor,
  ManagementPage,
  ManagementSection,
} from './management-primitives';

const clients = [
  ...CLI_COMMANDS.map((item) => ({
    ...item,
    value: item.command,
    hint: 'Run this command in your terminal, then follow the sign-in prompts.',
    icon: Terminal,
    kind: 'Command line',
  })),
  ...WEB_CLIENTS.map((item) => ({
    ...item,
    value: MACRO_MCP_URL,
    icon: Globe,
    kind: 'Web app',
  })),
  {
    key: 'json',
    label: 'Other IDE or MCP client',
    value: MACRO_MCP_CONFIG,
    hint: 'Add this configuration to your client’s MCP settings.',
    icon: Code,
    kind: 'Configuration',
  },
];

/** Client-specific setup pages for Macro's inbound MCP server. */
export function Agent() {
  const [selected, setSelected] = createSignal<string>();
  const client = () => clients.find((item) => item.key === selected());
  const { copiedKey, copy } = useClipboardCopy();
  return (
    <Show
      when={client()}
      keyed
      fallback={
        <ManagementPage
          title="Macro MCP server"
          description="Bring your Macro workspace into the agents and tools you already use."
        >
          <ManagementSection
            title="Connect a client"
            description="Choose your app for setup instructions."
          >
            <ManagementCard>
              <For each={clients}>
                {(item) => (
                  <button
                    type="button"
                    onClick={() => setSelected(item.key)}
                    class="flex w-full items-center gap-4 px-6 py-5 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <span class="flex size-10 items-center justify-center rounded-xl border border-edge-muted bg-ink/3 text-ink-muted">
                      <Dynamic component={item.icon} class="size-5" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span class="mt-1 block text-xs text-ink-muted">
                        {item.kind}
                      </span>
                    </span>
                    <CaretRight class="size-4 text-ink-muted" />
                  </button>
                )}
              </For>
            </ManagementCard>
          </ManagementSection>
          <ManagementSection
            title="Server address"
            description="For clients that support a remote HTTP MCP server."
          >
            <ManagementCard class="flex items-center gap-3 px-5 py-4">
              <code class="min-w-0 flex-1 break-all text-sm text-ink-muted">
                {MACRO_MCP_URL}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy('url', MACRO_MCP_URL)}
              >
                {copiedKey() === 'url' ? <Check /> : <Copy />}
                {copiedKey() === 'url' ? 'Copied' : 'Copy'}
              </Button>
            </ManagementCard>
          </ManagementSection>
        </ManagementPage>
      }
    >
      {(item) => (
        <ManagementEditor
          parent="Macro MCP server"
          title={`Connect ${item.label}`}
          onBack={() => setSelected(undefined)}
        >
          <ManagementSection title="Setup" description={item.hint}>
            <ManagementCard>
              <div class="flex items-center justify-between border-b border-edge-muted px-5 py-3">
                <span class="text-xs text-ink-muted">{item.kind}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(item.key, item.value)}
                >
                  {copiedKey() === item.key ? <Check /> : <Copy />}
                  {copiedKey() === item.key ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre class="overflow-x-auto whitespace-pre-wrap break-all px-5 py-5 text-sm leading-7 text-ink">
                <code>{item.value}</code>
              </pre>
            </ManagementCard>
          </ManagementSection>
        </ManagementEditor>
      )}
    </Show>
  );
}
