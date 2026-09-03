import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { IosPushNotificationModal } from '@core/mobile/IosPushNotificationModal';
import { IpadUnsupportedDialog } from '@core/mobile/IpadUnsupportedDialog';
import { BrowserNotificationModal } from '@notifications';

export function WorkspaceModals() {
  return (
    <>
      <BrowserNotificationModal />
      <IosPushNotificationModal />
      <IpadUnsupportedDialog />
      <GlobalShareInboxConflictDialog />
    </>
  );
}
