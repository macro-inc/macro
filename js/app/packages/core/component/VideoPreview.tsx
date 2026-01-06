import { staticFileIdEndpoint } from '@core/constant/servers';

export type VideoPreviewProps = {
  id: string;
  variant: 'small' | 'dynamic';
  width?: string | number | undefined | null;
  height?: string | number | undefined | null;
};

const THEMES = {
  small: 'min-h-[80px] size-15',
  dynamic: 'flex min-h-20 max-w-[480px] max-h-[480px] not-first:mt-2',
};

export function VideoPreview(props: VideoPreviewProps) {
  return (
    <div class={THEMES[props.variant]}>
      <video
        controls
        src={staticFileIdEndpoint(props.id)}
        width={props.width ?? undefined}
        height={props.height ?? undefined}
      />
    </div>
  );
}
