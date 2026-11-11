import { TaskListBar } from '@core/component/LexicalMarkdown/component/task-list/TaskListControls';
import { useTaskListAssigneeNames } from '@core/component/LexicalMarkdown/component/task-list/task-list-assignee-names';
import {
  type EffectiveItem,
  normalizeSettings,
  planChecklist,
} from '@core/component/LexicalMarkdown/plugins/checklist-controls/model';
import { createMemo, createSignal } from 'solid-js';
import { changeViewer, lookupIds, lookupSizes } from './network';

/** Real scoped label source and inline controls; task/document loading is supplied. */
export function TaskListLabelFixture() {
  changeViewer('macro|viewer@example.com');
  const [refs, setRefs] = createSignal([
    ...Array.from(
      { length: 501 },
      (_, index) => `macro|person${index}@example.com`
    ),
    'invalid-user',
  ]);
  const name = useTaskListAssigneeNames(refs);
  const [settings, setSettings] = createSignal(normalizeSettings(undefined));
  const items = createMemo((): EffectiveItem[] => [
    {
      key: 'task',
      leadingKeys: [],
      attachedKeys: [],
      text: 'Referenced task',
      checked: false,
      status: 'not-started',
      priority: null,
      due: null,
      assignees: refs().map((id) => ({ id, name: name(id) })),
    },
  ]);
  return (
    <main class="p-6 bg-page text-ink min-h-screen">
      <TaskListBar
        items={items}
        settings={settings}
        plan={() => planChecklist(items(), settings(), new Date())}
        hasTasks={() => true}
        hovered={() => true}
        update={(patch) => setSettings((value) => ({ ...value, ...patch }))}
      />
      <button
        class="mt-20"
        onClick={() => setRefs(['macro|person999@example.com'])}
      >
        Replace references
      </button>
      <output hidden data-testid="inline-names">
        {JSON.stringify([
          name('macro|person0@example.com'),
          name('macro|person500@example.com'),
          name('macro|person999@example.com'),
        ])}
      </output>
      <output hidden data-testid="inline-lookup-sizes">
        {JSON.stringify(lookupSizes())}
      </output>
      <output hidden data-testid="inline-lookup-ids">
        {JSON.stringify(lookupIds())}
      </output>
      <output hidden data-testid="inline-settings">
        {JSON.stringify(settings())}
      </output>
    </main>
  );
}
