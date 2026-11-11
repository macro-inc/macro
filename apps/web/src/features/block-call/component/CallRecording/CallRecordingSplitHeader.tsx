import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData } from '@entity';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import { callRecordingDownloadSource } from '../../queries/recording-download';
import { useCallAgain } from '../use-call-again';

export function CallRecordingSplitHeaderLoading() {
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-split-header-content relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
          <StaticSplitLabel
            label="Call Recording"
            icon={
              <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
            }
          />
        </div>
      </div>
    </SplitHeaderLeft>
  );
}

export function CallRecordingSplitHeader(props: { record: CallRecord }) {
  const record = () => props.record;
  const blockId = useBlockId();
  const callName = () => record().customName ?? record().channelName ?? 'Call';
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'call',
    itemType: 'call',
    name: callName(),
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  const { canCallAgain, callAgain } = useCallAgain(
    () => record().callId,
    () => record().channelId
  );
  const recordingDownload = createFileDownload(() =>
    callRecordingDownloadSource(record(), callName())
  );
  const ops = (): FileOperation[] => [
    { op: 'rename' },
    ...(record().recordingUrl
      ? [
          {
            group: 'file' as const,
            label: 'Download',
            icon: DownloadSimple,
            action: () =>
              fireAndForget(
                recordingDownload.start(),
                'call-recording-download'
              ),
          },
        ]
      : []),
    { op: 'delete' },
  ];

  const shareTool: BlockTool = {
    label: 'Share',
    icon: IconShared,
    action: openShare,
    buttonComponent: () => <ShareTrigger onClick={openShare} />,
    focusTarget: getShareDrawerRecipientInput,
  };

  const tools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: callName(),
          fileType: 'call',
        }),
      condition: isMobile,
    },
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: callName(),
          fileType: 'call',
        }),
      buttonComponent: (control) => (
        <ChatWithAgentButton
          grouped={control.grouped}
          entity={{
            type: 'document',
            id: blockId,
            name: callName(),
            fileType: 'call',
          }}
        />
      ),
    },
    shareTool,
  ];

  const menuTools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: callName(),
          fileType: 'call',
        }),
    },
    shareTool,
  ];

  return (
    <>
      <SplitHeaderLeft>
        <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
          <div class="ph-no-capture z-split-header-content relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
            <StaticSplitLabel
              label={callName()}
              icon={
                <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
              }
            />
          </div>
        </div>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <div class="-order-1">
          <BlockLiveIndicators />
        </div>
        <Show when={!isMobile() && !record().isActive && canCallAgain()}>
          <div class="order-[900] flex items-center">
            <HeaderActionGroup label="Call actions">
              <HeaderIsland>
                <ButtonGroup.Button
                  variant="secondary"
                  size={isTouchDevice() ? 'icon-xs' : 'icon-sm'}
                  class={isTouchDevice() ? 'bg-surface' : undefined}
                  tooltip="Call Again"
                  onClick={callAgain}
                >
                  <PhoneCallIcon class="size-4" />
                </ButtonGroup.Button>
              </HeaderIsland>
            </HeaderActionGroup>
          </div>
        </Show>
      </SplitHeaderRight>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={menuTools}
        ops={ops()}
        id={blockId}
        itemType="call"
        name={callName()}
        // Supply the record's current status and optional channel association.
        entity={buildEntityData({
          id: record().callId,
          name: callName(),
          blockName: 'call',
          channelId: record().channelId,
          isActive: record().isActive,
          status: record().status ?? undefined,
        })}
      />
    </>
  );
}
