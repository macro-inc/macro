import '@app/index.css';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { TagTree } from '../components/tag-tree';
import { buildTagTree } from '../core/tag-tree';
import { createTagDropTarget } from '../tag-drag-and-drop';

function Fixture() {
  const [applied, setApplied] = createSignal<string[]>(['Existing']);
  const [selected, setSelected] = createSignal('');
  const target = createTagDropTarget({
    onDropTag: (tag) =>
      setApplied((tags) => [...new Set([...tags, tag.label])]),
  });
  const nodes = buildTagTree([
    {
      id: 'urgent',
      label: 'Urgent',
      color: 'red',
      scope: 'user',
      propertyDefinitionId: 'fixture-tags',
    },
  ]);
  return (
    <main class="flex gap-8 p-8">
      <aside class="w-60">
        <TagTree
          nodes={nodes}
          activeIds={[]}
          isExpanded={() => true}
          onToggle={() => {}}
          onSelect={setSelected}
        />
      </aside>
      <div
        ref={(element) => target?.ref(element)}
        data-testid="row"
        class="w-80 p-8 border"
        classList={{ 'outline-2': target?.isOver() }}
      >
        <p>Example email</p>
        <output aria-label="Applied tags">{applied().join(', ')}</output>
      </div>
      <output aria-label="Filter">{selected()}</output>
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <ItemDndProvider>
      <Fixture />
    </ItemDndProvider>
  ),
  root
);
