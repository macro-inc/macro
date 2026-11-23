import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { buildEntityData } from '@app/features/entity/utils/buildEntityData';
import { t } from '@app/lib/i18n';
import { SidePanel } from '@components/app/side-panel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { SplitPanel } from '@components/app/split-panel';
import { getPermissions } from '@core/component/SharePermissions';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { fireAndForget } from '@core/util/fireAndForget';
import ShareIcon from '@icon/share.svg';
import { Show } from 'solid-js';
import type { CallDetailData } from './CallDetailView';

export function CallDetailMobileHeader(props: {
  callId: string;
  data?: CallDetailData;
}) {
  const name = () => props.data?.name ?? t('calls.detailFallbackName');
  const openShare = useShareModal(() => ({
    id: props.callId,
    blockAlias: 'call',
    itemType: 'call',
    name: name(),
    userPermissions: getPermissions(
      props.data?.record.userAccessLevel ?? undefined
    ),
    owner: props.data?.record.createdBy,
  }));
  return (
    <>
      <SplitHeaderLeft>
        <HeaderIsland class="px-1">
          <SplitPanel.CloseButton />
        </HeaderIsland>
        <StaticSplitLabel label={name()} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <HeaderIsland class="size-10 justify-center !px-0">
          <SidePanel.Toggle />
        </HeaderIsland>
      </SplitHeaderRight>
      <Show when={props.data}>
        {(data) => (
          <SplitTitleFileMenu>
            <SplitFileMenu
              id={props.callId}
              itemType="call"
              entityKind="call"
              name={name()}
              permissions={getPermissions(
                data().record.userAccessLevel ?? undefined
              )}
              entity={buildEntityData({
                id: props.callId,
                name: name(),
                blockName: 'call',
                channelId: data().record.channelId,
                isActive: data().record.isActive,
                status: data().record.status ?? undefined,
              })}
              ops={[]}
              tools={[
                {
                  get label() {
                    return t('channelComposer.askMacro');
                  },
                  icon: ChatWithAgentIcon,
                  action: () =>
                    fireAndForget(
                      openChatWithAgent({
                        type: 'document',
                        id: props.callId,
                        name: name(),
                        fileType: 'call',
                      }),
                      'call-detail'
                    ),
                },
                {
                  get label() {
                    return t('entityActions.share');
                  },
                  icon: ShareIcon,
                  action: openShare,
                  focusTarget: getShareDrawerRecipientInput,
                  group: 'sharing',
                },
              ]}
            />
          </SplitTitleFileMenu>
        )}
      </Show>
    </>
  );
}
