import '@app/index.css';
import { PromoCard } from '@app/features/sidebar-promotion/components/promo-card';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import FileCsvIcon from '@phosphor/file-csv.svg';
import FileZipIcon from '@phosphor/file-zip.svg';
import FolderIcon from '@phosphor/folder.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ConnectorImportProvider } from '../context/connector-import-context';
import type { ConnectorImportContext } from '../context/contracts';
import { IMPORT_CATEGORIES } from '../core/catalog';
import type { ImportCategory } from '../core/providers';
import { ConnectorImportDialog } from '../views/import-dialog';

// The real card and dialog over in-memory connections: Pipedream connects at
// once, GitHub's native authorization finishes a moment later as if in
// another tab, and every import hands off to the agent.
const [connected, setConnected] = createSignal<ReadonlySet<string>>(
  new Set(['dropbox'])
);
const [handoff, setHandoff] = createSignal('');

const context: ConnectorImportContext = {
  createConnections: () => ({ connected, ready: () => true }),
  connect: async (app) => {
    const add = () =>
      setConnected((previous) => new Set([...previous, app.appSlug]));
    if (!app.mcpUrl) {
      add();
      return 'connected';
    }
    setTimeout(add, 400);
    return 'started';
  },
  startAgentImport: async (value) => {
    setHandoff(value.input);
  },
};

function Sidebar(props: { category: ImportCategory }) {
  const [open, setOpen] = createSignal(false);
  const [hidden, setHidden] = createSignal(false);
  const config = IMPORT_CATEGORIES[props.category];
  return (
    <aside
      class="flex h-[440px] w-64 flex-col bg-panel px-2 py-3"
      aria-label={`${props.category} sidebar`}
    >
      <p class="px-2 text-sm font-semibold text-ink">{config.action}</p>
      <div class="mt-auto">
        {hidden() ? null : (
          <PromoCard
            logos={config.providers}
            headline={config.headline}
            pitch={config.pitch}
            action={{ label: config.action, onClick: () => setOpen(true) }}
            dismissLabel={`Dismiss ${config.action.toLowerCase()}`}
            onDismiss={() => setHidden(true)}
          />
        )}
      </div>
      <ConnectorImportDialog
        config={config}
        open={open()}
        onOpenChange={setOpen}
        alternatives={(() => {
          const alternative =
            props.category === 'crm'
              ? {
                  icon: FileCsvIcon,
                  label: 'Upload a CSV',
                  description: 'Import companies from a spreadsheet export.',
                  onSelect: () => {},
                }
              : props.category === 'channels'
                ? {
                    icon: FileZipIcon,
                    label: 'Import with history',
                    description:
                      'Upload a Slack export from a workspace owner or admin.',
                    onSelect: () => setHandoff('Slack export upload'),
                  }
                : undefined;
          return alternative
            ? [alternative]
            : props.category === 'files'
              ? [
                  {
                    icon: UploadIcon,
                    label: 'Upload files',
                    description: 'Choose files from this computer.',
                    onSelect: () => setHandoff('Upload files'),
                  },
                  {
                    icon: FolderIcon,
                    label: 'Upload a folder',
                    description: 'Bring over a folder and everything in it.',
                    onSelect: () => setHandoff('Upload a folder'),
                  },
                ]
              : undefined;
        })()}
      />
    </aside>
  );
}

function Fixture() {
  return (
    <ConnectorImportProvider context={context}>
      <main class="flex min-h-screen gap-6 bg-page p-6">
        <For each={['files', 'tasks', 'crm', 'channels'] as const}>
          {(category) => <Sidebar category={category} />}
        </For>
        <output aria-label="Agent handoff" class="text-xs text-ink-muted">
          {handoff()}
        </output>
      </main>
    </ConnectorImportProvider>
  );
}

// Apply dark explicitly too: `dark-mode:` styles key off the theme attribute.
applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? 'Macro Light'
    : 'Macro Dark'
);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
