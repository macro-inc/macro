import ClipboardIcon from '@phosphor/clipboard.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { Button, type ButtonSize } from '@ui';
import type { createImageActions } from './createImageActions';

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
        variant="ghost"
        size={size()}
        onClick={() => props.actions.copyToClipboard()}
        disabled={disabled()}
        label="Copy image"
      >
        {props.actions.isCopying() ? (
          <Spinner class="animate-spin" />
        ) : (
          <ClipboardIcon />
        )}
      </Button>
      <Button
        variant="ghost"
        size={size()}
        onClick={() => props.actions.downloadImage()}
        disabled={disabled()}
        label="Download image"
      >
        {props.actions.isDownloading() ? (
          <Spinner class="animate-spin" />
        ) : (
          <DownloadIcon />
        )}
      </Button>
    </>
  );
}
