import { LoadingSpinner } from '@core/component/LoadingSpinner';
import ShareFat from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function UnknownContent(props: {
  fileName: string;
  /** Set while a legacy Office file is being upgraded, e.g. "PowerPoint presentation". */
  convertingTo?: string;
  onShare: () => void;
  onDownload: () => void;
}) {
  return (
    <div class="flex h-full flex-col items-center justify-center">
      <div class="mx-4 flex w-fit flex-col items-center justify-center gap-4 p-4">
        <Show
          when={props.convertingTo}
          fallback={
            <div class="text-center text-lg">
              No preview available for{' '}
              <span class="text-ink-muted">{props.fileName}</span>
            </div>
          }
        >
          {(convertingTo) => (
            <div
              class="flex flex-col items-center gap-2 text-center text-lg"
              data-testid="legacy-office-converting"
            >
              <LoadingSpinner class="size-5" />
              <div>
                Converting <span class="text-ink-muted">{props.fileName}</span>{' '}
                to a {convertingTo()}…
              </div>
            </div>
          )}
        </Show>

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
