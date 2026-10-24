import { useNavigate } from '@app/lib/split-router';
import { externalRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ItemPreview } from '@core/component/ItemPreview';
import { getPermissions } from '@core/component/SharePermissions';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { Suspense } from 'solid-js';
import { WhatsAppGroupProvider } from './context/whatsapp-group-context';
import { createWhatsAppGroupCapabilities } from './queries/capabilities';
import { whatsappGroupApi } from './queries/production-api';
import { WhatsAppGroupView } from './views/whatsapp-group-view';

export function WhatsAppGroup(props: { groupId: string }) {
  const userId = useUserId();
  const navigate = useNavigate();
  const source = createWhatsAppGroupCapabilities(
    whatsappGroupApi,
    () => userId() ?? '',
    () => props.groupId
  );
  useSplitDisplayName(() => source.group.data?.name ?? 'WhatsApp group');
  const share = useShareModal(() => {
    const group = source.group.data;
    if (!group) return;
    return {
      id: props.groupId,
      itemType: 'whatsapp_group',
      blockAlias: 'whatsapp_group',
      name: group.name,
      owner: group.ownerId,
      userPermissions: getPermissions(group.accessLevel),
    };
  });
  return (
    <WhatsAppGroupProvider value={source}>
      <WhatsAppGroupView
        leading={<SplitPanel.CloseButton class="shrink-0" />}
        userId={userId()}
        onShare={share}
        onConnect={() => navigate({ route: externalRoute, params: {} })}
        renderAttachment={(id) => (
          <Suspense
            fallback={
              <span class="text-xs text-ink-muted">Loading attachment…</span>
            }
          >
            <ItemPreview id={id} type="document" />
          </Suspense>
        )}
      />
    </WhatsAppGroupProvider>
  );
}
