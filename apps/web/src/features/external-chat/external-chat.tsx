import { useNavigate } from '@app/lib/split-router';
import { externalRoute } from '@app/routes/routes';
import { SidePanel } from '@components/app/side-panel';
import {
  useSplitDisplayName,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import type { JSX } from 'solid-js';
import { ExternalChatContextProvider } from './context/external-chat-context';
import { createExternalChatCapabilities } from './queries/capabilities';
import { externalChatApi } from './queries/production-api';
import { ExternalChatView } from './views/external-chat-view';

export function ExternalChat(props: {
  chatId: string;
  /** Header control before the title; defaults to closing the split. */
  leading?: JSX.Element;
}) {
  const userId = useUserId();
  const panel = useSplitPanel();
  const navigate = useNavigate();
  const source = createExternalChatCapabilities(
    externalChatApi,
    () => userId() ?? '',
    () => props.chatId
  );
  useSplitDisplayName(() => source.chat.data?.name ?? 'Chat');
  const share = useShareModal(() => {
    const chat = source.chat.data;
    if (!chat) return;
    return {
      id: props.chatId,
      itemType: 'external_chat',
      blockAlias: 'external_chat',
      name: chat.name,
      owner: chat.ownerId,
      userPermissions: getPermissions(chat.accessLevel),
    };
  });
  return (
    <ExternalChatContextProvider value={source}>
      {/* Like an in-view email thread: the details panel floats over the
          conversation and starts closed. */}
      <SidePanel.Root floating defaultOpen={false}>
        <ExternalChatView
          leading={props.leading}
          userId={userId()}
          share={
            <ShareTrigger
              onClick={share}
              id={props.chatId}
              blockType="external_chat"
              hotkeyScope={panel?.splitHotkeyScope}
            />
          }
          onShare={share}
          onConnect={() => navigate({ route: externalRoute, params: {} })}
        />
      </SidePanel.Root>
    </ExternalChatContextProvider>
  );
}
