import { For } from 'solid-js';
import { workspaceFeatures } from '../../marketing/core/workspace-features';

/** Use the same fixture content as the corresponding feature page. */
export default function GuideToolGraphic(props: {
  kind: 'calendar' | 'canvas' | 'snippets';
}) {
  const feature = () => workspaceFeatures[props.kind];
  return (
    <div class="guide-workspace guide-tool" data-tool={props.kind}>
      <div class="guide-workspace-back">
        <div class="guide-workspace-heading">{feature().product}</div>
        <div class="guide-tool-title">{feature().sceneTitle}</div>
        <For each={feature().rows}>
          {(row) => <div class="guide-tool-row">{row}</div>}
        </For>
      </div>
      <div class="guide-workspace-front">
        <div class="guide-workspace-heading">Julia</div>
        <div class="guide-workspace-copy">{feature().message}</div>
      </div>
    </div>
  );
}
