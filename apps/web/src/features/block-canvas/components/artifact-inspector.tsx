import {
  ARTIFACT_HTML_MAX_LENGTH,
  type ArtifactContent,
  type ArtifactItem,
} from '@macro-inc/graphics';
import { InspectorField } from './inspector-field';
import { InspectorSection } from './inspector-section';

export function ArtifactInspector(props: {
  item: ArtifactItem;
  onChange: (content: ArtifactContent) => void;
  position: number;
  count: number;
  onMove: (delta: number) => void;
  onPresent: () => void;
}) {
  return (
    <InspectorSection title="Artifact">
      <InspectorField label="Title">
        <input
          class="w-full rounded border border-edge-muted bg-panel px-2 py-1 text-xs text-ink outline-none focus:border-edge-focus"
          aria-label="Artifact title"
          value={props.item.geometry.title}
          onChange={(event) =>
            props.onChange({ title: event.currentTarget.value })
          }
        />
      </InspectorField>
      <InspectorField label="HTML">
        <textarea
          class="h-48 w-full resize-y rounded border border-edge-muted bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-edge-focus"
          aria-label="Artifact HTML"
          spellcheck={false}
          maxLength={ARTIFACT_HTML_MAX_LENGTH}
          value={props.item.geometry.html}
          onChange={(event) =>
            props.onChange({ html: event.currentTarget.value })
          }
        />
      </InspectorField>
      <button
        type="button"
        class="w-full rounded px-2 py-1 text-xs text-accent hover:bg-hover"
        onClick={props.onPresent}
      >
        Present
      </button>
      <InspectorField label={`Presented ${props.position} of ${props.count}`}>
        <div class="flex gap-1">
          <button
            type="button"
            class="flex-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover disabled:text-ink-muted"
            disabled={props.position <= 1}
            onClick={() => props.onMove(-1)}
          >
            Earlier
          </button>
          <button
            type="button"
            class="flex-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover disabled:text-ink-muted"
            disabled={props.position >= props.count}
            onClick={() => props.onMove(1)}
          >
            Later
          </button>
        </div>
      </InspectorField>
    </InspectorSection>
  );
}
