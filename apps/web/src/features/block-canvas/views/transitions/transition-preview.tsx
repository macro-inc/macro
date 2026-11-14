import type {
  ArtifactItem,
  GraphicsDocument,
  SlideTransition,
} from '@macro-inc/graphics';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { SlideStage } from './slide-stage';

/** Time the first slide shows before the transition plays. */
const LEAD_IN_MS = 350;

/** A blank slide beside `slide`, for previewing into a deck's only slide. */
function blankBefore(slide: ArtifactItem): ArtifactItem {
  const { transition: _own, ...geometry } = slide.geometry;
  return {
    ...slide,
    id: `${slide.id}-preview-blank`,
    geometry: { ...geometry, html: '' },
  };
}

/**
 * Plays the transition into one slide on a small stage: from the slide before
 * it (or after it, for the first slide) as present mode would. Mount it again
 * to replay.
 */
export function TransitionPreview(props: {
  document: GraphicsDocument;
  slides: readonly ArtifactItem[];
  slide: ArtifactItem;
  deckDefault: SlideTransition | undefined;
}) {
  const index = props.slides.findIndex((item) => item.id === props.slide.id);
  const from =
    props.slides[index - 1] ??
    props.slides[index + 1] ??
    blankBefore(props.slide);
  const [current, setCurrent] = createSignal(from.id);
  const slides = () => {
    const to =
      props.slides.find((item) => item.id === props.slide.id) ?? props.slide;
    const start = props.slides.find((item) => item.id === from.id) ?? from;
    return [start, to];
  };

  onMount(() => {
    const timer = setTimeout(() => setCurrent(props.slide.id), LEAD_IN_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      data-canvas-transition-preview
      class="w-full overflow-hidden rounded-md bg-[black]"
      style={{
        'aspect-ratio': `${props.slide.geometry.designWidth} / ${props.slide.geometry.designHeight}`,
      }}
    >
      <SlideStage
        document={props.document}
        slides={slides()}
        current={slides().find((item) => item.id === current())}
        deckDefault={props.deckDefault}
        interactive={false}
        surface="preview"
      />
    </div>
  );
}
