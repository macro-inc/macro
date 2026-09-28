import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import Spinner from '@phosphor/spinner.svg';
import type { FetchProgress } from '@service-storage/util/fetchPresigned';
import { createSignal } from 'solid-js';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1
  );
  const value = bytes / 1024 ** exp;
  const decimals = exp === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${SIZE_UNITS[exp]}`;
}

function DownloadProgressBar(props: { progress: FetchProgress }) {
  const hasTotal = () => props.progress.total > 0;
  const percent = () =>
    hasTotal()
      ? Math.min(
          100,
          Math.round((props.progress.loaded / props.progress.total) * 100)
        )
      : 0;

  return (
    <div class="space-y-1">
      <div class="h-1 w-full overflow-hidden rounded-full bg-edge">
        <div
          class="h-full bg-accent transition-[width] duration-150 ease-linear"
          classList={{ 'animate-pulse w-full': !hasTotal() }}
          style={hasTotal() ? { width: `${percent()}%` } : undefined}
        />
      </div>
      <div class="text-xs text-ink-extra-muted">
        {hasTotal() ? `${percent()}% — ` : ''}
        {formatBytes(props.progress.loaded)}
        {hasTotal() ? ` of ${formatBytes(props.progress.total)}` : ''}
      </div>
    </div>
  );
}

export async function downloadWithProgress(
  fileName: string,
  load: (onProgress: (progress: FetchProgress) => void) => Promise<Blob>
) {
  const [progress, setProgress] = createSignal<FetchProgress>({
    loaded: 0,
    total: 0,
  });
  const toastId = toast.custom(
    {
      title: `Downloading ${fileName}`,
      icon: () => <Spinner class="size-5 animate-spin text-accent" />,
      color: 'var(--color-accent)',
      content: () => <DownloadProgressBar progress={progress()} />,
    },
    { persistent: true }
  );

  try {
    const blob = await load(setProgress);
    downloadFile(blob, fileName);
    toast.dismiss(toastId);
    toast.success(`Downloaded ${fileName}`);
  } catch (error) {
    toast.dismiss(toastId);
    console.error('error downloading file', error);
    toast.failure('Error downloading file');
  }
}
