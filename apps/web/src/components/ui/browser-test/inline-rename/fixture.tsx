import '@app/index.css';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Key } from '@solid-primitives/keyed';
import { Dropdown } from '@ui/components/Dropdown';
import {
  createInlineRename,
  RenameInput,
  RenameTitle,
} from '@ui/components/InlineRename';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

type Named = { id: string; name: string };

/** Renames a local list; a name starting with "Locked" is refused. */
function createLocalRename(
  items: () => Named[],
  setItems: (update: (items: Named[]) => Named[]) => void
) {
  return createInlineRename({
    key: (item: Named) => item.id,
    name: (item) => items().find(({ id }) => id === item.id)?.name ?? '',
    rename: (item, name) => {
      if (item.name.startsWith('Locked')) return errAsync('Could not rename');
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, name } : entry
        )
      );
      return okAsync(undefined);
    },
    failureMessage: (failure: string) => failure,
  });
}

function Header() {
  const [documents, setDocuments] = createSignal<Named[]>([
    { id: 'plan', name: 'Launch plan' },
  ]);
  const rename = createLocalRename(documents, setDocuments);
  const document = () => documents()[0];
  let renameAfterClose = false;
  return (
    <header class="flex h-12 items-center gap-2 border-b border-edge-muted px-4">
      <RenameTitle
        rename={rename}
        target={document()}
        startOn="double-click"
        aria-label="Name"
        class="text-sm font-semibold"
      />
      <Dropdown>
        <Dropdown.Trigger aria-label="File actions" variant="ghost" size="sm">
          …
        </Dropdown.Trigger>
        <Dropdown.Content
          onCloseAutoFocus={() => {
            if (!renameAfterClose) return;
            renameAfterClose = false;
            queueMicrotask(() => rename.begin(document()));
          }}
        >
          <Dropdown.Item onSelect={() => (renameAfterClose = true)}>
            Rename
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
    </header>
  );
}

function Rows() {
  const [rows, setRows] = createSignal<Named[]>([
    { id: 'roadmap', name: 'Product roadmap' },
    { id: 'notes', name: 'Meeting notes' },
    { id: 'locked', name: 'Locked budget' },
  ]);
  const rename = createLocalRename(rows, setRows);
  let renameAfterClose: Named | undefined;
  return (
    <div role="grid" aria-label="Documents" class="flex flex-col p-2">
      <Key each={rows()} by="id">
        {(row) => (
          <ContextMenu>
            <ContextMenuTrigger class="w-full">
              <div
                role="row"
                tabIndex={0}
                aria-label={row().name}
                class="flex h-10 items-center rounded-md px-3 text-sm focus-visible:bg-hover"
              >
                <Show
                  when={rename.isRenaming(row())}
                  fallback={
                    <span class="truncate">{rename.displayName(row())}</span>
                  }
                >
                  <RenameInput rename={rename} aria-label="Name" width="fill" />
                </Show>
              </div>
            </ContextMenuTrigger>
            <ContextMenu.Portal>
              <ContextMenuContent
                class="min-w-48"
                onCloseAutoFocus={() => {
                  const target = renameAfterClose;
                  if (!target) return;
                  renameAfterClose = undefined;
                  queueMicrotask(() => rename.begin(target));
                }}
              >
                <MenuItem
                  text="Rename"
                  onClick={() => (renameAfterClose = row())}
                />
              </ContextMenuContent>
            </ContextMenu.Portal>
          </ContextMenu>
        )}
      </Key>
    </div>
  );
}

function Heading() {
  const [projects, setProjects] = createSignal<Named[]>([
    { id: 'offsite', name: 'Summer offsite' },
  ]);
  const rename = createLocalRename(projects, setProjects);
  return (
    <div class="px-6 pt-6">
      <RenameTitle
        rename={rename}
        target={projects()[0]}
        startOn="click"
        aria-label="Project name"
        class="block w-full text-2xl font-semibold"
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <main class="min-h-screen bg-panel text-ink">
      <Header />
      <Heading />
      <Rows />
    </main>
  ),
  root
);
