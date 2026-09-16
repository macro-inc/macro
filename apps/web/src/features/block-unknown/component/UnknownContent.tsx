import DownloadSimple from '@phosphor/download-simple.svg';
import ShareFat from '@phosphor/share.svg';
import { Button } from '@ui';

export function UnknownContent(props: {
  fileName: string;
  onShare: () => void;
  onDownload: () => void;
}) {
  return (
    <div class="flex h-full flex-col items-center justify-center">
      <div class="mx-4 flex w-fit flex-col items-center justify-center gap-4 p-4">
        <div class="text-center text-lg">
          No preview available for{' '}
          <span class="text-ink-muted">{props.fileName}</span>
        </div>

        <div class="flex flex-row items-center gap-2">
          <Button variant="accent" onClick={props.onShare}>
            <ShareFat class="size-4" /> Share
          </Button>

          <Button variant="accent" onClick={props.onDownload}>
            <DownloadSimple class="size-4" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}
