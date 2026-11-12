import { type Accessor, For } from 'solid-js';

/** Replace only the remote task search. Selection remains owned by AddProjectTasks. */
export function PropertyEntitySelector(props: {
  config: { excludedIds: Accessor<ReadonlySet<string>> };
  selectedOptions: Accessor<Set<string>>;
  setSelectedOptions(ids: Set<string>): void;
}) {
  return (
    <div class="flex flex-col gap-2 p-3">
      <input aria-label="Search tasks" placeholder="Search tasks…" />
      <For each={['linked', 'one', 'two']}>
        {(id) => (
          <label class="flex gap-2" for={`task-${id}`}>
            <input
              id={`task-${id}`}
              type="checkbox"
              disabled={props.config.excludedIds().has(id)}
              checked={props.selectedOptions().has(id)}
              onChange={(event) => {
                const selected = new Set(props.selectedOptions());
                if (event.currentTarget.checked) selected.add(id);
                else selected.delete(id);
                props.setSelectedOptions(selected);
              }}
            />
            {id}
          </label>
        )}
      </For>
    </div>
  );
}
