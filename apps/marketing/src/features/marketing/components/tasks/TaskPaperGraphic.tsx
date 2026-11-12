import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
import { PaperTaskProperties } from './paper/PaperTaskProperties';
import { PaperTaskPropertiesMobile } from './paper/PaperTaskPropertiesMobile';
import { PaperTaskRow } from './paper/PaperTaskRow';
import { PaperTaskRowMobile } from './paper/PaperTaskRowMobile';
import { PaperTaskViews } from './paper/PaperTaskViews';
import './paper/paper-task-art.css';
import './task-paper-graphic.css';

/** Rahul’s three task illustrations, with his compact artboards on phones. */
export function TaskPaperGraphic(props: {
  kind: 'tasks' | 'properties' | 'views';
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const size = createElementSize(viewport);
  const compact = () => (size.width ?? 584) < 500;
  const mobileArt = () => compact() && props.kind !== 'views';
  const artWidth = () => (mobileArt() ? 374 : 584);
  const scale = () => (size.width ?? 584) / artWidth();
  const description = () => {
    if (props.kind === 'properties')
      return 'Task properties: tags, due date, project, assignees, and creator.';
    if (props.kind === 'views')
      return 'Task view controls: filter, list, board, Gantt, sort, and group.';
    return 'Task rows with annotations for priority, name, and status.';
  };

  return (
    <div class="task-paper-graphic">
      <FeatureDemoBackdrop />
      <div
        ref={setViewport}
        class="task-paper-viewport paper-task-art"
        data-compact={compact()}
        data-view={props.kind}
        role="img"
        aria-label={description()}
        style={{ height: `${(mobileArt() ? 360 : 544) * scale()}px` }}
      >
        <div
          class="task-paper-canvas"
          aria-hidden="true"
          style={{
            width: `${artWidth()}px`,
            transform: `scale(${scale()})`,
          }}
        >
          <Switch>
            <Match when={props.kind === 'tasks'}>
              <Show when={mobileArt()} fallback={<PaperTaskRow />}>
                <PaperTaskRowMobile />
              </Show>
            </Match>
            <Match when={props.kind === 'properties'}>
              <Show when={mobileArt()} fallback={<PaperTaskProperties />}>
                <PaperTaskPropertiesMobile />
              </Show>
            </Match>
            <Match when={props.kind === 'views'}>
              <PaperTaskViews />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
