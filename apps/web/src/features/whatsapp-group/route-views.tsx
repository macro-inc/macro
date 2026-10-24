import { useNavigate, useRouteParams } from '@app/lib/split-router';
import {
  externalWhatsappGroupRoute,
  whatsappGroupRoute,
} from '@app/routes/routes';
import { fireAndForget } from '@core/util/fireAndForget';
import { onMount } from 'solid-js';
import { WhatsAppGroupSkeleton } from './whatsapp-group-entry';

/** Retired `/whatsapp-group/:groupId` links open the group inside External. */
export function WhatsAppGroupRedirectRouteView() {
  const params = useRouteParams(whatsappGroupRoute);
  const navigate = useNavigate();
  onMount(() =>
    fireAndForget(
      navigate(
        {
          route: externalWhatsappGroupRoute,
          params: { groupId: params.groupId },
        },
        { replace: true }
      ),
      'whatsapp-group.redirect'
    )
  );
  return <WhatsAppGroupSkeleton />;
}
