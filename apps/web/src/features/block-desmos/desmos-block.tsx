/**
 * Adapter: reads block identity and permissions once, then mounts the
 * graphing calculator without any further block-state hooks.
 */

import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { createSignal, onCleanup, Show } from 'solid-js';
import {
  DESMOS_MIME,
  emptyDesmosDocument,
  type GraphDocument,
  parseDesmosDocument,
  serializeDesmosDocument,
} from './core/document';
import type { DesmosData } from './definition';
import { saveDesmosDocument } from './queries/save-desmos';
import { DesmosEditor } from './views/desmos-editor';

export default function DesmosBlock() {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const nested = useIsNestedBlock();
  const canEdit = useCanEdit();
  const name = useBlockDocumentName('Untitled graph');
  const downloadName = useBlockDocumentDownloadName('Untitled graph');
  const permissions = useGetPermissions();
  const copyEntityLink = useCopyLink();
  const loaded = () => blockDataSignal.get() as DesmosData | undefined;
  const initial = (): GraphDocument => {
    const text = loaded() && 'text' in loaded()! ? loaded()!.text : null;
    if (typeof text !== 'string') return emptyDesmosDocument();
    return parseDesmosDocument(text) ?? emptyDesmosDocument();
  };
  const unavailable = () =>
    loaded() != null && 'text' in loaded()! && loaded()!.text == null;

  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'desmos',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const [graph, setGraph] = createSignal(initial());
  const [saveState, setSaveState] = createSignal<
    'saved' | 'unsaved' | 'saving' | 'error'
  >('saved');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: GraphDocument | undefined;
  let flushTail: Promise<void> = Promise.resolve();

  const flush = () => {
    flushTail = flushTail.then(async () => {
      if (!pending || !canEdit()) return;
      const next = pending;
      pending = undefined;
      setSaveState('saving');
      const result = await saveDesmosDocument(documentId, next);
      if (pending) {
        setSaveState('unsaved');
      } else {
        setSaveState(result.saved ? 'saved' : 'error');
      }
    });
    return flushTail;
  };

  const queueSave = (next: GraphDocument) => {
    if (!canEdit()) return;
    setGraph(next);
    pending = next;
    setSaveState('unsaved');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 1500);
  };

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', onHidden);
  onCleanup(() => {
    document.removeEventListener('visibilitychange', onHidden);
    if (saveTimer) clearTimeout(saveTimer);
    void flush();
  });

  const download = () => {
    const file = new File(
      [serializeDesmosDocument(graph())],
      downloadName().endsWith('.desmos')
        ? downloadName()
        : `${downloadName()}.desmos`,
      { type: DESMOS_MIME }
    );
    downloadFile(file, file.name);
  };

  const ops: FileOperation[] = [
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadSimple,
      action: download,
    },
    { op: 'delete' },
  ];

  const copyLink = () => {
    copyEntityLink(buildSimpleEntityUrl({ type: 'desmos', id: documentId }));
  };

  return (
    <DocumentBlockContainer>
      <Show
        when={!unavailable()}
        fallback={
          <div
            class="flex size-full items-center justify-center text-ink-muted text-sm"
            data-testid="desmos-unavailable"
          >
            Desmos graphs are not enabled for this workspace.
          </div>
        }
      >
        <SidePanel.Root defaultOpen={false} floating>
          <div class="flex size-full min-w-0 flex-col overflow-hidden">
            <Show when={!nested}>
              <SidePanel.Layout floating>
                <FileSidePanelSections />
                <div class="flex size-full min-w-0 flex-col overflow-hidden">
                  <div>
                    <SplitHeaderLeft>
                      <BlockItemSplitLabel />
                      <FileTypeChip />
                    </SplitHeaderLeft>
                    <SplitHeaderRight>
                      <div class="-order-1 touch:hidden">
                        <BlockLiveIndicators />
                      </div>
                    </SplitHeaderRight>
                    <ResponsivePermissionsBadge />
                    <span
                      class="sr-only"
                      data-testid="desmos-save-state"
                      data-state={saveState()}
                    >
                      {saveState()}
                    </span>
                    <ResponsiveBlockToolbar
                      tools={[
                        {
                          group: 'sharing',
                          label: 'Share',
                          icon: IconShared,
                          action: openShare,
                          buttonComponent: () => (
                            <ShareTrigger
                              onClick={openShare}
                              copyLink={copyLink}
                            />
                          ),
                          focusTarget: getShareDrawerRecipientInput,
                        },
                      ]}
                      ops={ops}
                      id={documentId}
                      itemType="document"
                      name={name()}
                    />
                  </div>
                  <DesmosEditor
                    initial={initial()}
                    canEdit={canEdit()}
                    nested={false}
                    onChange={queueSave}
                  />
                </div>
              </SidePanel.Layout>
            </Show>
            <Show when={nested}>
              <DesmosEditor
                initial={initial()}
                canEdit={canEdit()}
                nested
                onChange={queueSave}
              />
            </Show>
          </div>
        </SidePanel.Root>
      </Show>
    </DocumentBlockContainer>
  );
}
