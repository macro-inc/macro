import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

const MIN_IMAGE_HEIGHT = 50;
const MAX_SCALE_FACTOR = 10;

interface ResizeHandleProps {
  scale: () => number;
  setScale: (scale: number) => void;
  side: 'left' | 'right';
  imageDims: () => [number, number];
  containerRef: HTMLDivElement;
}

export function ResizeHandle(props: ResizeHandleProps) {
  let handleRef!: HTMLDivElement;
  const [isDragging, setIsDragging] = createSignal(false);
  const [innerVisible, setInnerVisible] = createSignal(false);
  const [startX, setStartX] = createSignal(0);
  const [startHeight, setStartHeight] = createSignal(0);
  const [originalHeight, setOriginalHeight] = createSignal(0);

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setStartX(e.clientX);

    const containerRect = props.containerRef.getBoundingClientRect();
    setStartHeight(containerRect.height);
    setOriginalHeight(props.imageDims()[1]);
    handleRef.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging()) return;

    e.preventDefault();
    e.stopPropagation();

    const totalDeltaX = e.clientX - startX();

    let deltaHeight = totalDeltaX;

    if (props.side === 'left') {
      deltaHeight = -deltaHeight;
    }

    const targetHeight = Math.max(
      MIN_IMAGE_HEIGHT,
      startHeight() + deltaHeight
    );

    if (originalHeight() > 0) {
      const targetScale = targetHeight / originalHeight();
      const newScale = Math.max(0.1, Math.min(MAX_SCALE_FACTOR, targetScale));
      props.setScale(newScale);
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!isDragging()) return;

    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
    handleRef.releasePointerCapture(e.pointerId);
  };

  const handlePointerEnter = () => {
    setInnerVisible(true);
  };

  const handlePointerLeave = () => {
    setInnerVisible(false);
  };

  onMount(() => {
    handleRef.addEventListener('pointerdown', handlePointerDown);
    handleRef.addEventListener('pointermove', handlePointerMove);
    handleRef.addEventListener('pointerup', handlePointerUp);
  });

  createEffect(() => {
    if (!props.containerRef) return;

    props.containerRef.addEventListener('pointerenter', handlePointerEnter);
    props.containerRef.addEventListener('pointerleave', handlePointerLeave);

    onCleanup(() => {
      if (props.containerRef) {
        props.containerRef.removeEventListener(
          'pointerenter',
          handlePointerEnter
        );
        props.containerRef.removeEventListener(
          'pointerleave',
          handlePointerLeave
        );
      }
    });
  });

  onCleanup(() => {
    handleRef.removeEventListener('pointerdown', handlePointerDown);
    handleRef.removeEventListener('pointermove', handlePointerMove);
    handleRef.removeEventListener('pointerup', handlePointerUp);
  });

  return (
    <div
      ref={handleRef}
      class="w-4 absolute top-0 h-full cursor-col-resize z-1"
      classList={{
        'right-0': props.side === 'right',
        'left-0': props.side === 'left',
      }}
      style={{
        'touch-action': 'none',
      }}
    >
      <div
        class="w-1 h-[50%] min-h-8 absolute top-1/2 bg-ink ring-2 ring-panel rounded-full transition-all duration-200 pointer-events-none"
        classList={{
          'right-3': props.side === 'right',
          'left-3': props.side === 'left',
        }}
        style={{
          opacity: innerVisible() || isDragging() ? 0.5 : 0,
          transform: `translateY(-50%) ${isDragging() ? 'scale(1.2)' : 'scale(1)'}`,
        }}
      />
    </div>
  );
}
