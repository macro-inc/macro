import '@fontsource-variable/inter';
import '../../../index.css';
import type { MacrodStatus } from '@macro/tauri/macrod';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type { NewLocalAgent, SetupCapabilities } from '../core/setup';
import { LocalRuntimeSetupDialog } from '../views/local-runtime-setup-dialog';
import { LocalRuntimeSetupPanel } from '../views/local-runtime-setup-panel';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') !== 'dark'
);
const theme = params.get('theme') === 'dark' ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

/**
 * `happy` connects and creates the agent; `fail-once` loses the first
 * pairing; `none` finds no agents; `hold` stops while linking.
 */
const scenario = params.get('scenario') ?? 'happy';
const delay = Number(params.get('delay') ?? 150);

const RUNNING: MacrodStatus = {
  phase: 'running',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  workspace: '/Users/sample/Macro',
  pairingCode: null,
  pairingExpiresAt: null,
  harnessId: 'harness-1',
  lastError: null,
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

let connects = 0;
const capabilities: SetupCapabilities = {
  detectAgents: async () => {
    await wait(delay);
    return scenario === 'none'
      ? []
      : [
          {
            id: 'codex',
            name: 'Codex',
            note: null,
            needs_install: true,
          },
          {
            id: 'claude-code',
            name: 'Claude Code',
            note: null,
            needs_install: false,
          },
        ];
  },
  startDaemon: async () => ({ ...RUNNING, phase: 'starting' }),
  waitForRunning: async (onPhase) => {
    connects++;
    onPhase('starting');
    await wait(delay);
    onPhase('pairing');
    if (scenario === 'hold') await new Promise(() => {});
    await wait(delay);
    if (scenario === 'fail-once' && connects === 1) {
      throw new Error('The pairing code expired before it was approved.');
    }
    return RUNNING;
  },
  listAgents: async () => [],
  loadModels: async () => ({
    status: 'available',
    currentModel: 'sonnet',
    models: [{ id: 'sonnet', name: 'Sonnet' }],
  }),
  createAgent: async (agent: NewLocalAgent) => {
    await wait(delay);
    return { botId: 'bot-1', name: agent.name, handle: agent.handle };
  },
  sleep: wait,
};

function Fixture() {
  const [open, setOpen] = createSignal(true);
  const [action, setAction] = createSignal('');
  return (
    <main class="min-h-screen bg-panel p-6">
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Open setup
      </Button>
      <p role="status" aria-label="Preview action" class="mt-3 text-sm">
        {action()}
      </p>
      <LocalRuntimeSetupDialog open={open()} onClose={() => setOpen(false)}>
        <Show when={open()}>
          <LocalRuntimeSetupPanel
            capabilities={capabilities}
            onOpenSession={(agent) => setAction(`Opened @${agent.handle}`)}
            defaultWorkspace="/Users/sample/Macro"
            autoStart={params.get('auto') !== 'false'}
            onClose={() => setOpen(false)}
          />
        </Show>
      </LocalRuntimeSetupDialog>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
