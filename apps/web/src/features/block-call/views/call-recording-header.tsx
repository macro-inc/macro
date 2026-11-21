import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitPermissionsBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { useCallRecordingHeaderTools } from './shared/call-recording-header-parts';

/**
 * The call recording block's header on desktop. Call again and Ask Macro
 * arrive through the side panel's header actions from the recording body.
 */
export function CallRecordingHeader(props: { record: CallRecord }) {
  const { blockId, callName, ops, openShare, entity, actions } =
    useCallRecordingHeaderTools(() => props.record);

  return (
    <>
      <SplitHeaderLeft>
        <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
          <div class="ph-no-capture z-split-header-content relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
            <StaticSplitLabel
              label={callName()}
              icon={<PhoneCallIcon class="size-4 shrink-0 text-ink-muted" />}
            />
          </div>
        </div>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <div class="-order-1">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <BlockToolbar
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[actions.askMacro, actions.share]}
        ops={ops()}
        id={blockId}
        itemType="call"
        name={callName()}
        entity={entity()}
      />
    </>
  );
}
