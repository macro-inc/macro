import type { ArtifactContent, ArtifactItem } from '@macro-inc/graphics';
import { Button, Input } from '@ui';
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
        <Input
          size="sm"
          aria-label="Artifact title"
          value={props.item.geometry.title}
          onChange={(event) =>
            props.onChange({ title: event.currentTarget.value })
          }
        />
      </InspectorField>
      <Button variant="ghost" size="sm" onClick={props.onPresent}>
        Present
      </Button>
      <InspectorField label={`Presented ${props.position} of ${props.count}`}>
        <div class="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={props.position <= 1}
            onClick={() => props.onMove(-1)}
          >
            Earlier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.position >= props.count}
            onClick={() => props.onMove(1)}
          >
            Later
          </Button>
        </div>
      </InspectorField>
    </InspectorSection>
  );
}
