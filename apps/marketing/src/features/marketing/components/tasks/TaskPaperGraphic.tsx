import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, Show } from 'solid-js';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
import { PaperTaskProperties } from './paper/PaperTaskProperties';
import { PaperTaskPropertiesMobile } from './paper/PaperTaskPropertiesMobile';
import './paper/paper-task-art.css';
import './task-paper-graphic.css';

/** Rahul’s task properties illustration, with his compact artboard on phones. */
export function TaskPaperGraphic() {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const size = createElementSize(viewport);
  const compact = () => (size.width ?? 584) < 500;
  const artWidth = () => (compact() ? 374 : 584);
  const scale = () => (size.width ?? 584) / artWidth();

  return (
    <div class="task-paper-graphic">
      <FeatureDemoBackdrop />
      <div
        ref={setViewport}
        class="task-paper-viewport paper-task-art"
        data-compact={compact()}
        role="img"
        aria-label="Task properties: tags, due date, project, assignees, and creator."
        style={{ height: `${(compact() ? 360 : 544) * scale()}px` }}
      >
        <div
          class="task-paper-canvas"
          aria-hidden="true"
          style={{
            width: `${artWidth()}px`,
            transform: `scale(${scale()})`,
          }}
        >
          <Show when={compact()} fallback={<PaperTaskProperties />}>
            <PaperTaskPropertiesMobile />
          </Show>
        </div>
      </div>
    </div>
  );
}
