import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCanvasArtifacts } from '@core/constant/featureFlags';
import type { ShapeViewProps } from '@macro-inc/graphics/solid';
import { Show } from 'solid-js';
import { ArtifactFrame } from './artifact-frame';

export function CanvasArtifactView(
  props: ShapeViewProps<'artifact'> & {
    active: boolean;
    onEnter: () => void;
    onExit: () => void;
  }
) {
  const flag = useFeatureFlag(enableCanvasArtifacts);
  const title = () => props.item.geometry.title || 'Artifact';

  return (
    <div
      data-canvas-artifact={props.item.id}
      data-canvas-embed-active={props.active ? props.item.id : undefined}
      class="group relative size-full overflow-hidden bg-panel"
      onDblClick={(event) => {
        if (!flag().enabled || props.active) return;
        event.stopPropagation();
        props.onEnter();
      }}
      style={{
        opacity: props.item.appearance.opacity ?? 1,
        'border-radius': `${props.item.appearance.cornerRadius ?? 0}px`,
        border: `${props.item.appearance.strokeWidth ?? 0}px solid ${props.item.appearance.stroke}`,
        'box-sizing': 'border-box',
      }}
    >
      <Show
        when={flag().enabled}
        fallback={
          <div class="grid size-full place-items-center p-4 text-center text-sm text-ink-muted">
            {title()}
          </div>
        }
      >
        <ArtifactFrame
          html={props.item.geometry.html}
          title={title()}
          designWidth={props.item.geometry.designWidth}
          designHeight={props.item.geometry.designHeight}
          interactive={props.active}
        />
        <div class="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
          <button
            type="button"
            class="menu-surface rounded px-2 py-1 text-xs text-accent hover:bg-hover"
            onClick={(event) => {
              event.stopPropagation();
              if (props.active) props.onExit();
              else props.onEnter();
            }}
          >
            {props.active ? 'Done' : 'Interact'}
          </button>
        </div>
      </Show>
    </div>
  );
}
