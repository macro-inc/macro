import {
  ARTIFACT_HTML_MAX_LENGTH,
  type ArtifactContent,
  type ArtifactItem,
} from '@macro-inc/graphics';
import { Input } from '@ui';
import { InspectorField } from './inspector-field';
import { InspectorSection } from './inspector-section';

export function ArtifactInspector(props: {
  item: ArtifactItem;
  onChange: (content: ArtifactContent) => void;
}) {
  return (
    <InspectorSection title="Artifact">
      <InspectorField label="Title">
        <Input
          size="sm"
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
    </InspectorSection>
  );
}
