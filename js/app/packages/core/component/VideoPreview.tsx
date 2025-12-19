import { staticFileIdEndpoint } from '@core/constant/servers';

export type VideoPreviewProps = {
  id: string;
  variant: 'small' | 'dynamic';
};

const THEMES = {
  small: 'min-h-[80px] size-15',
  dynamic: 'flex min-h-20 max-w-[480px] max-h-[480px] not-first:mt-2',
};

export function VideoPreview(props: VideoPreviewProps) {
  return (
    <div class={THEMES[props.variant]}>
      <video controls src={staticFileIdEndpoint(props.id)} />
    </div>
  );
}
