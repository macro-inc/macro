import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import { useMessageRootsQuery } from '@queries/messages/document-messages';
import { Badge } from '@ui';
import { createMemo, Match, onMount, Show, Switch } from 'solid-js';
import type { DocxBlockData } from './definition';
import {
  buildDocxSeed,
  connectDocxSync,
  docxSyncExists,
  fetchOriginalDocx,
  initializeDocxSync,
} from './queries/docx-document';
import { createDocxSession } from './queries/docx-session';
import { DocxCommentMargin, DocxDetachedComments } from './views/DocxComments';
import { DocxEditorView } from './views/DocxEditorView';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function displayName(userId: string | undefined) {
  return getDisplayName(tryMacroId(userId ?? ''), {
    emailFallback: 'local-part',
  });
}

/** Production composition of the collaborative DOCX editor. */
export default function DocxBlock(props: { share?: string }) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Document');
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const isOwner = useIsDocumentOwner();
  const userId = useUserId();
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'write',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  onMount(() => {
    if (props.share === 'true') openShare();
  });
  const data = () => {
    const value = blockDataSignal.get() as
      | (DocxBlockData & { __block?: string })
      | undefined;
    return value?.__block === 'write' && 'documentMetadata' in value
      ? value
      : undefined;
  };
  const fileName = () => {
    const base = name() || 'Document';
    return /\.docx$/i.test(base) ? base : `${base}.docx`;
  };
  const parent = () => ({ type: 'document' as const, id: documentId });
  const roots = useMessageRootsQuery(parent);
  // Gated: reading a pending query's data would suspend and blank the editor.
  const rootThreads = () => (roots.isSuccess ? (roots.data ?? []) : []);
  const reportError = (error: unknown) => {
    console.error('DOCX editor error', error);
    toast.failure(
      error instanceof Error ? error.message : 'Something went wrong'
    );
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderLeft>
          <BlockItemSplitLabel
            trailingBadges={
              <Badge variant="outline" size="xs">
                Beta
              </Badge>
            }
          />
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <BlockLiveIndicators />
        </SplitHeaderRight>
        <ResponsivePermissionsBadge />
        <ResponsiveBlockToolbar
          id={documentId}
          itemType="document"
          name={name()}
          ops={[{ op: 'rename' }, { op: 'moveToProject' }, { op: 'delete' }]}
          tools={[
            {
              group: 'sharing',
              label: 'Share',
              icon: IconShared,
              action: openShare,
              buttonComponent: () => <ShareTrigger onClick={openShare} />,
              focusTarget: getShareDrawerRecipientInput,
            },
          ]}
        />
        <Show when={data()} keyed>
          {(loaded) => {
            const session = createDocxSession({
              documentId,
              userId: userId(),
              canEdit,
              canComment,
              exists: () => docxSyncExists(documentId),
              fetchOriginal: () => fetchOriginalDocx(documentId),
              buildSeed: buildDocxSeed,
              initialize: (snapshot) =>
                initializeDocxSync(documentId, snapshot),
              connect: () =>
                connectDocxSync(documentId, loaded.token, loaded.authorization),
            });
            const state = session.state;
            // Remount the editor only when the collaborative document is replaced.
            const target = createMemo(
              () => {
                const current = state();
                if (current.t === 'ready')
                  return { doc: current.doc, original: undefined };
                if (current.t === 'original')
                  return { doc: null, original: current.bytes };
                return undefined;
              },
              undefined,
              {
                equals: (a, b) =>
                  a?.doc === b?.doc && a?.original === b?.original,
              }
            );
            return (
              <Switch>
                <Match when={state().t === 'error'}>
                  <div class="p-6 text-sm text-failure">
                    {(() => {
                      const current = state();
                      return current.t === 'error'
                        ? current.message
                        : 'The document editor could not be loaded.';
                    })()}
                  </div>
                </Match>
                <Match when={!target()}>
                  <div class="p-6 text-sm text-ink-muted">
                    Opening document…
                  </div>
                </Match>
                <Match when={target()} keyed>
                  {({ doc, original }) => (
                    <DocxEditorView
                      doc={doc}
                      original={original}
                      canEdit={!!doc && canEdit()}
                      canComment={() => !!doc && canComment()}
                      fileName={fileName()}
                      peers={session.peers}
                      displayName={displayName}
                      author={displayName(userId())}
                      onSelection={session.setSelection}
                      commentRoots={doc ? rootThreads : undefined}
                      margin={(context) => (
                        <DocxCommentMargin
                          documentId={documentId}
                          comments={context.comments}
                          geometry={context.geometry}
                          selectionTop={context.selectionTop}
                          canComment={() => !!doc && canComment()}
                          isOwner={isOwner}
                          userId={userId}
                        />
                      )}
                      footer={(comments) => (
                        <>
                          <DocxDetachedComments
                            documentId={documentId}
                            threads={comments.detached()}
                            canComment={canComment}
                            isOwner={isOwner}
                          />
                          <EntityDiscussion
                            parent={parent()}
                            canWrite={canComment()}
                            canModerate={isOwner()}
                            link={{ type: 'write', id: documentId }}
                            label="Discussion"
                          />
                        </>
                      )}
                      onDownload={(bytes) =>
                        downloadFile(
                          new Blob([bytes.slice().buffer], {
                            type: DOCX_MIME,
                          }),
                          fileName()
                        )
                      }
                      onError={reportError}
                    />
                  )}
                </Match>
              </Switch>
            );
          }}
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
