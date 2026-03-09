import { staticFileIdEndpoint } from '@core/constant/servers';

export type VideoPreviewProps = {
  id: string;
  variant: 'small' | 'dynamic';
  width?: string | number | undefined | null;
  height?: string | number | undefined | null;
};

const CONTAINER_THEMES = {
  small:
    'size-15 overflow-hidden rounded-2xl border border-edge-muted bg-menu select-none',
  dynamic: 'flex min-h-20 max-w-[480px] max-h-[480px] not-first:mt-2',
};

const VIDEO_THEMES = {
  small: 'size-full object-cover',
  dynamic: '',
};

export function VideoPreview(props: VideoPreviewProps) {
  return (
    <div class={CONTAINER_THEMES[props.variant]}>
      <video
        class={VIDEO_THEMES[props.variant]}
        controls={props.variant !== 'small'}
        preload="metadata"
        playsinline
        muted={props.variant === 'small'}
        src={staticFileIdEndpoint(props.id)}
        width={props.width ?? undefined}
        height={props.height ?? undefined}
      />
    </div>
  );
}
