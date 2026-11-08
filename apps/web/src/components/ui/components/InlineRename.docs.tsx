import { defineDoc } from '@app/features/ui-gallery/types';
import { okAsync } from 'neverthrow';
import { createSignal, For } from 'solid-js';
import { Button } from './Button';
import { createInlineRename, RenameTitle } from './InlineRename';

type DemoEntity = { id: string; name: string };

// #region demo:title
function TitleDemo() {
  const [entity, setEntity] = createSignal<DemoEntity>({
    id: 'roadmap',
    name: 'Product roadmap',
  });
  const rename = createInlineRename({
    key: (target: DemoEntity) => target.id,
    name: (target) => target.name,
    rename: (target, name) => {
      setEntity({ ...target, name });
      return okAsync(undefined);
    },
    failureMessage: (failure: string) => failure,
  });
  return (
    <div class="flex items-center gap-3">
      <RenameTitle
        rename={rename}
        target={entity()}
        startOn="double-click"
        aria-label="Document name"
        class="text-sm font-semibold"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => rename.begin(entity())}
      >
        Rename
      </Button>
    </div>
  );
}
// #endregion

// #region demo:heading
function HeadingDemo() {
  const [entity, setEntity] = createSignal<DemoEntity>({
    id: 'launch',
    name: 'Launch plan',
  });
  const rename = createInlineRename({
    key: (target: DemoEntity) => target.id,
    name: (target) => target.name,
    rename: (target, name) => {
      setEntity({ ...target, name });
      return okAsync(undefined);
    },
    failureMessage: (failure: string) => failure,
  });
  return (
    <RenameTitle
      rename={rename}
      target={entity()}
      startOn="click"
      aria-label="Project name"
      placeholder="Untitled project"
      class="text-xl font-semibold"
    />
  );
}
// #endregion

// #region demo:validation
function ValidationDemo() {
  const [tables, setTables] = createSignal<DemoEntity[]>([
    { id: 'tasks', name: 'Tasks' },
    { id: 'people', name: 'People' },
  ]);
  const rename = createInlineRename({
    key: (target: DemoEntity) => target.id,
    name: (target) => target.name,
    rename: (target, name) => {
      setTables((current) =>
        current.map((table) =>
          table.id === target.id ? { ...table, name } : table
        )
      );
      return okAsync(undefined);
    },
    failureMessage: (failure: string) => failure,
    validate: (name, target) =>
      tables().some((table) => table.id !== target.id && table.name === name)
        ? 'A table with this name already exists.'
        : undefined,
  });
  return (
    <div class="flex gap-4">
      <For each={tables()}>
        {(table) => (
          <RenameTitle
            rename={rename}
            target={table}
            startOn="double-click"
            aria-label="Table name"
            class="text-sm"
          />
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'InlineRename',
  category: 'Inputs',
  description:
    'Renames an entity title in place, with one behaviour everywhere: double-click (a page heading: click), F2 or a Rename menu item opens the field with the name selected; Enter and blur commit, Escape restores, an empty or unchanged name is a no-op, a refused name keeps the field open with the reason, and a commit shows the new name at once and puts the old one back with a toast if the rename fails.',
  status: 'stable',
  exports: ['createInlineRename', 'RenameTitle', 'RenameInput'],
  import: "import { createInlineRename, RenameInput, RenameTitle } from '@ui';",
  demos: [
    {
      id: 'title',
      title: 'Compact title with a Rename action',
      render: TitleDemo,
    },
    { id: 'heading', title: 'Page heading', render: HeadingDemo },
    { id: 'validation', title: 'Refused names', render: ValidationDemo },
  ],
});
