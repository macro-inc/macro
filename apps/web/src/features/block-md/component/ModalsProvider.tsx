import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import type { ParentProps } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';

export function ModalsProvider(props: ParentProps) {
  const { documentId } = useMarkdownDocument();
  const notificationSource = useGlobalNotificationSource();

  return (
    <>
      {props.children}
      <NotificationsDrawer
        entity={{ id: documentId(), type: 'document' }}
        notificationSource={notificationSource}
      />
    </>
  );
}
