import { useRouteParams } from '@app/lib/split-router';
import { whatsappGroupRoute } from '@app/routes/routes';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import {
  WhatsAppGroupEntry,
  WhatsAppGroupSkeleton,
} from './whatsapp-group-entry';

export const WhatsAppGroupRouteView = withAuth(() => {
  const params = useRouteParams(whatsappGroupRoute);
  usePageViewTracking('whatsapp-group');
  return <WhatsAppGroupEntry groupId={params.groupId} />;
}, WhatsAppGroupSkeleton);
