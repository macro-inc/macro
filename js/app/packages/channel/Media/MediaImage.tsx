import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { cn } from '@ui/utils/classname';
import { type ParentProps, type JSX, Show, createSignal } from 'solid-js';
const ATTACHMENT_TILE_SIZE = 92;

function ImagePlaceholder(props: {
  dims?: { width: number; height: number };
  square?: boolean;
}) {
  return (
    <div
      class="flex items-center justify-center rounded-2xl border border-edge bg-menu"
      style={
        props.square
          ? {
              width: `${ATTACHMENT_TILE_SIZE}px`,
              height: `${ATTACHMENT_TILE_SIZE}px`,
            }
          : props.dims
            ? {
                width: `${props.dims.width}px`,
                height: `${props.dims.height}px`,
              }
            : {
                width: '60px',
                height: '60px',
              }
      }
    >
      <Spinner class="h-4 w-4 animate-spin" />
    </div>
  );
}

function Root(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn('relative flex rounded-2xl', props.class)}>
      {props.children}
    </div>
  );
}

function Fallback(props: {
  dims?: { width: number; height: number };
  square?: boolean;
}) {
  return <ImagePlaceholder dims={props.dims} square={props.square} />;
}

function Image(props: {
  src: string;
  onOpen?: () => void;
  class?: string;
  width?: number;
  height?: number;
  style?: JSX.CSSProperties;
  loading?: 'eager' | 'lazy';
  fallback?: JSX.Element;
}) {
  const [loaded, setLoaded] = createSignal(false);

  return (
    <>
      <Show when={!loaded()}>{props.fallback}</Show>
      <img
        class={cn(props.class, props.onOpen && 'cursor-pointer')}
        classList={{ invisible: !loaded(), absolute: !loaded() }}
        src={props.src}
        alt="preview"
        width={props.width}
        height={props.height}
        style={props.style}
        loading={props.loading}
        onClick={() => props.onOpen?.()}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

export const MediaImage = {
  Root,
  Fallback,
  Image,
};
