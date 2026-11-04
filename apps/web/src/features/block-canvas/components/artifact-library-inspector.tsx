import type {
  ArtifactLibrary,
  ArtifactLibraryEdit,
  ArtifactLibraryKind,
} from '@macro-inc/graphics/loro';
import { ARTIFACT_LIBRARY_ENTRY_MAX_LENGTH } from '@macro-inc/graphics/loro';
import { createSignal, For } from 'solid-js';
import { InspectorField } from './inspector-field';
import { InspectorSection } from './inspector-section';

export function ArtifactLibraryInspector(props: {
  library: ArtifactLibrary;
  onEdit: (edit: ArtifactLibraryEdit) => void;
}) {
  const [name, setName] = createSignal('');
  const add = (kind: ArtifactLibraryKind) => {
    const trimmed = name().trim();
    if (!trimmed) return;

    props.onEdit({ kind, name: trimmed, source: '' });
    setName('');
  };
  const entries = (
    kind: ArtifactLibraryKind,
    label: (name: string) => string
  ) => (
    <For each={Object.keys(props.library[kind]).sort()}>
      {(entry) => (
        <InspectorField label={label(entry)}>
          <textarea
            class="h-24 w-full resize-y rounded border border-edge-muted bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-edge-focus"
            aria-label={label(entry)}
            spellcheck={false}
            maxLength={ARTIFACT_LIBRARY_ENTRY_MAX_LENGTH}
            value={props.library[kind][entry]}
            onChange={(event) =>
              props.onEdit({
                kind,
                name: entry,
                // An emptied entry is a removed entry.
                source: event.currentTarget.value || null,
              })
            }
          />
        </InspectorField>
      )}
    </For>
  );

  return (
    <InspectorSection title="Shared with this canvas's artifacts">
      {entries('styles', (entry) => `Style: ${entry}`)}
      {entries('components', (entry) => `Component: ${entry}`)}
      <input
        class="w-full rounded border border-edge-muted bg-panel px-2 py-1 text-xs text-ink outline-none focus:border-edge-focus"
        aria-label="New shared entry name"
        placeholder="Name"
        value={name()}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <div class="flex gap-1">
        <button
          type="button"
          class="flex-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover"
          onClick={() => add('styles')}
        >
          Add style
        </button>
        <button
          type="button"
          class="flex-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover"
          onClick={() => add('components')}
        >
          Add component
        </button>
      </div>
    </InspectorSection>
  );
}
