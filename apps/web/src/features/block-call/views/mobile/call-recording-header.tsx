import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { isMobile } from '@core/mobile/isMobile';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { Show } from 'solid-js';
import { useCallAgain } from '../../component/use-call-again';
import { createRecordingIdentity } from '../../primitives/recording-identity';
import { useCallRecordingHeaderTools } from '../shared/call-recording-header-parts';

/**
 * The call recording block's header on touch: the title with its menu, who
 * else is viewing, Call again (tablets, for an ended call) and Ask Macro, and
 * Info.
 */
export function MobileCallRecordingHeader(props: {
  record: CallRecord;
  callId: string;
}) {
  const record = () => props.record;
  const { blockId, callName, ops, entity, actions } =
    useCallRecordingHeaderTools(record);
  const { title } = createRecordingIdentity(record);
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.callId,
    () => record().channelId
  );
  const showCallAgain = () =>
    !isMobile() && !record().isActive && canCallAgain();

  return (
    <MobileBlockHeader
      id={blockId}
      name={callName()}
      iconType="call"
      icon={<PhoneCallIcon class="size-6 shrink-0 text-ink-muted" />}
      itemType="call"
      entity={entity()}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops()}
      trailing={
        <>
          <BlockLiveIndicators />
          <MobileHeader.Island>
            <Show when={showCallAgain()}>
              <HeaderActionButton
                grouped
                onClick={callAgain}
                label={t('calls.detailCallAgain')}
                tooltip={t('calls.detailCallAgain')}
                icon={<PhoneCallIcon class="size-4" />}
              />
            </Show>
            <AskMacroButton
              grouped
              entity={{
                type: 'document',
                id: props.callId,
                name: title(),
                fileType: 'call',
              }}
            />
          </MobileHeader.Island>
        </>
      }
    />
  );
}
