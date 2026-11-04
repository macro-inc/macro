import Spinner from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import ClipboardIcon from '@icon/system/regular/clipboard.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import { Button } from '@ui';
import type { createImageActions } from './createImageActions';

type ImageActionButtonsProps = {
  actions: ReturnType<typeof createImageActions>;
};

/** Copy + download buttons for a single image, driven by `createImageActions`. */
export function ImageActionButtons(props: ImageActionButtonsProps) {
  const disabled = () =>
    props.actions.isBusy() || props.actions.isPrefetching();

  return (
    <>
      <Button
        aria-label="Copy image"
        tooltip="Copy image"
        variant="ghost"
        size="icon-md"
        onClick={() => props.actions.copyToClipboard()}
        disabled={disabled()}
      >
        {props.actions.isCopying() ? (
          <Spinner class="size-4 touch:size-6 shrink-0 pointer-events-none animate-spin" />
        ) : (
          <ClipboardIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        )}
      </Button>
      <Button
        aria-label="Download image"
        tooltip="Download image"
        variant="ghost"
        size="icon-md"
        onClick={() => props.actions.downloadImage()}
        disabled={disabled()}
      >
        {props.actions.isDownloading() ? (
          <Spinner class="size-4 touch:size-6 shrink-0 pointer-events-none animate-spin" />
        ) : (
          <DownloadIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        )}
      </Button>
    </>
  );
}
