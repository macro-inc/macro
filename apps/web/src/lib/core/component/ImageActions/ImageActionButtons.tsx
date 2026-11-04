import Spinner from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import ClipboardIcon from '@icon/system/regular/clipboard.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import { Button, type ButtonSize } from '@ui';
import type { createImageActions } from './createImageActions';

const GLYPH_CLASS = 'size-4 touch:size-6 shrink-0 pointer-events-none';

type ImageActionButtonsProps = {
  actions: ReturnType<typeof createImageActions>;
  size?: ButtonSize;
};

/** Copy + download buttons for a single image, driven by `createImageActions`. */
export function ImageActionButtons(props: ImageActionButtonsProps) {
  const size = () => props.size ?? 'icon-md';
  const disabled = () =>
    props.actions.isBusy() || props.actions.isPrefetching();

  return (
    <>
      <Button
        aria-label="Copy image"
        tooltip="Copy image"
        variant="ghost"
        size={size()}
        onClick={() => props.actions.copyToClipboard()}
        disabled={disabled()}
      >
        {props.actions.isCopying() ? (
          <Spinner class={`${GLYPH_CLASS} animate-spin`} />
        ) : (
          <ClipboardIcon class={GLYPH_CLASS} />
        )}
      </Button>
      <Button
        aria-label="Download image"
        tooltip="Download image"
        variant="ghost"
        size={size()}
        onClick={() => props.actions.downloadImage()}
        disabled={disabled()}
      >
        {props.actions.isDownloading() ? (
          <Spinner class={`${GLYPH_CLASS} animate-spin`} />
        ) : (
          <DownloadIcon class={GLYPH_CLASS} />
        )}
      </Button>
    </>
  );
}
