import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/component/ChatWithAgentButton';
import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import { SidePanel } from '@app/component/side-panel';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useCall } from '@channel/Call/use-call';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import PhoneCallIcon from '@icon/wide-call.svg';
import IconShared from '@icon/wide-share.svg';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';

export function CallRecordingSplitHeaderLoading() {
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-page-overlay relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
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

export function CallRecordingSplitHeader(props: {
  record: Accessor<CallRecord>;
}) {
  const record = props.record;
  const blockId = useBlockId();
  const shareCtx = useShareDialogContext();
  const callName = () => record().customName ?? record().channelName ?? 'Call';
  const call = useCall(() => record().channelId);

  const tools: BlockTool[] = [
    {
      label: 'Call Again',
      icon: PhoneCallIcon,
      action: () => call.joinCall(),
      condition: () => !record().isActive,
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
      divideAbove: true,
      buttonComponent: () => (
        <ChatWithAgentButton
          entity={{
            type: 'document',
            id: blockId,
            name: callName(),
            fileType: 'call',
          }}
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
          <div class="ph-no-capture z-page-overlay relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
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
      </SplitHeaderRight>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={[{ op: 'copy' }]}
        id={blockId}
        itemType="call"
        name={callName()}
      />
      <SplitToolbarLeft>
        <SidePanel.NarrowTabs />
      </SplitToolbarLeft>
    </>
  );
}
