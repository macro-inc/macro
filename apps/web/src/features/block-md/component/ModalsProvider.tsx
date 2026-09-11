import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { DetailsDrawer } from '@core/component/DetailsDrawer';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
} from '@core/component/TopBar/ShareButton';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createSignal, type ParentProps, Suspense } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useMarkdownName } from './MarkdownNameProvider';

export function ModalsProvider(props: ParentProps) {
  const markdownDocument = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const notificationSource = useGlobalNotificationSource();
  const metadataQuery = useDocumentMetadataQuery(markdownDocument.documentId);
  const [shareOpen, setShareOpen] = createSignal(false);

  const blockAlias = (): 'md' | 'task' | 'snippet' | 'skill' => {
    const kind = markdownDocument.kind();
    return kind === 'document' ? 'md' : kind;
  };
  const permissions = () => {
    if (markdownDocument.permissions.isOwner()) return Permissions.OWNER;
    if (markdownDocument.permissions.canEdit()) return Permissions.CAN_EDIT;
    if (markdownDocument.permissions.canComment()) {
      return Permissions.CAN_COMMENT;
    }
    return Permissions.CAN_VIEW;
  };

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      {props.children}
      <NotificationsDrawer
        entity={{ id: markdownDocument.documentId(), type: 'document' }}
        notificationSource={notificationSource}
      />
      <ReferencesDrawer
        documentId={markdownDocument.documentId()}
        documentName={displayName()}
      />
      <DetailsDrawer documentId={markdownDocument.documentId()} />
      <Suspense>
        <ShareModal
          isSharePermOpen={shareOpen()}
          setIsSharePermOpen={setShareOpen}
          id={markdownDocument.documentId()}
          blockAlias={blockAlias()}
          itemType="document"
          name={displayName() ?? ''}
          userPermissions={permissions()}
          owner={metadataQuery.data?.owner}
        />
      </Suspense>
    </ShareDialogContext.Provider>
  );
}
