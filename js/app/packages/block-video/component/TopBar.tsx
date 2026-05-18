import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';

import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import {
  REFERENCES_DRAWER_ID,
  ReferencesButton,
} from '@core/component/ReferencesModal';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/download.svg';
import Info from '@icon/info.svg';
import Quotes from '@icon/quotes.svg';
import Spinner from '@icon/spinner.svg';
import IconShared from '@macro-icons/wide/share.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { createSignal } from 'solid-js';
import { useGetFileBlob } from '../signal/blockData';

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const downloadDocument = createCallback(async () => {
    const fileName = downloadName();
    const [progress, setProgress] = createSignal({ loaded: 0, total: 0 });

    const toastId = toast.custom(
      {
        title: `Downloading ${fileName}`,
        icon: () => <Spinner class="text-accent size-5 animate-spin" />,
        color: 'var(--color-accent)',
        content: () => <DownloadProgressBar progress={progress()} />,
      },
      { persistent: true }
    );

    try {
      const blob = await getBlob({ onProgress: setProgress });
      downloadFile(blob, fileName);
      toast.dismiss(toastId);
      toast.success(`Downloaded ${fileName}`);
    } catch (e) {
      toast.dismiss(toastId);
      console.error('error downloading file', e);
      toast.failure('Error downloading file');
    }
  });

  const ops: FileOperation[] = [
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
    { op: 'rename', divideAbove: true },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Download',
      icon: Download,
      action: downloadDocument,
      divideAbove: true,
    },
    { op: 'delete', divideAbove: true },
  ];

  const tools: BlockTool[] = [
    {
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
      buttonComponent: () => (
        <ReferencesButton
          documentId={blockId}
          documentName={name()}
          buttonSize="sm"
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name()}
      />
    </>
  );
}

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

function DownloadProgressBar(props: {
  progress: { loaded: number; total: number };
}) {
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
      <div class="h-1 w-full bg-edge rounded-full overflow-hidden">
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
