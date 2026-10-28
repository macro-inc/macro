import { createSignal, onCleanup, onMount } from 'solid-js';
import { TimelineArtworkBand } from '../../../app/routes/RouteDocuments';

export function HomepageVersionHistory(props: {
  position: number;
  onPause: () => void;
  onSeek: (position: number) => void;
}) {
  let root!: HTMLDivElement;
  const [geometry, setGeometry] = createSignal({
    top: 0,
    left: 0,
    width: 0,
    range: [755, 793] as readonly [number, number],
  });
  onMount(() => {
    const measure = () => {
      const svg = root.querySelector('svg');
      if (!svg) return;
      const bounds = root.getBoundingClientRect();
      const art = svg.getBoundingClientRect();
      if (!art.width || !bounds.width) return;
      const scale = art.width / 1211;
      const left = bounds.width * 0.25;
      const width = bounds.width * 0.5;
      const start = (bounds.left + left - art.left) / scale;
      setGeometry({
        top: art.top - bounds.top + 103 * scale,
        left,
        width,
        range: [start, start + width / scale],
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="homepage-history" ref={root}>
      <TimelineArtworkBand
        topGap="0px"
        position={props.position}
        positionRange={geometry().range}
      />
      <p
        class="homepage-history-caption"
        style={{ top: `${geometry().top}px` }}
      >
        <span>An audit log for every edit.</span>
        Track changes by humans and agents over time.
      </p>
      <input
        class="homepage-history-slider"
        type="range"
        min="0"
        max="1000"
        step="1"
        value={Math.round(props.position * 1000)}
        aria-label="Document version history"
        aria-valuetext={`${Math.round(props.position * 100)}% through Julia's edits`}
        aria-description="Drag to move backward or forward through Julia's edits"
        style={{
          top: `${geometry().top - 22}px`,
          left: `${geometry().left - 22}px`,
          width: `${geometry().width + 44}px`,
        }}
        onPointerDown={props.onPause}
        onKeyDown={props.onPause}
        onInput={(event) =>
          props.onSeek(Number(event.currentTarget.value) / 1000)
        }
      />
    </div>
  );
}
