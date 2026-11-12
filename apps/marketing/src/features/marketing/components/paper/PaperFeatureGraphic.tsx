import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX, Show } from 'solid-js';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
import './paper-feature-art.css';
import './paper-feature-graphic.css';

/** Static Paper art, scaled with its annotations to the full section width. */
export function PaperFeatureGraphic(props: {
  label: string;
  children: JSX.Element;
  mobile?: JSX.Element;
  height?: number;
  mobileHeight?: number;
  backdrop?: boolean;
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const size = createElementSize(viewport);
  const compact = () => (size.width ?? 584) < 500;
  const artWidth = () => (compact() ? 374 : 584);
  const scale = () => (size.width ?? 584) / artWidth();

  return (
    <div class="paper-feature-graphic">
      <Show when={props.backdrop !== false}>
        <FeatureDemoBackdrop />
      </Show>
      <div
        ref={setViewport}
        class="paper-feature-viewport paper-feature-art"
        data-compact={compact()}
        role="img"
        aria-label={props.label}
        style={{
          height: `${(compact() ? (props.mobileHeight ?? (props.mobile ? 360 : (props.height ?? 544))) : (props.height ?? 544)) * scale()}px`,
        }}
      >
        <div
          class="paper-feature-canvas"
          aria-hidden="true"
          style={{
            width: `${artWidth()}px`,
            transform: `scale(${scale()})`,
          }}
        >
          <Show when={compact() && props.mobile} fallback={props.children}>
            {props.mobile}
          </Show>
        </div>
      </div>
    </div>
  );
}
