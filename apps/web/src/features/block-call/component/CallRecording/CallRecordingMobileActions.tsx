import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';

export function CallRecordingMobileActions(props: {
  callId: string;
  name: string;
  active: boolean;
}) {
  return (
    <FloatRegion region="accessory" active={() => props.active}>
      <div class="flex justify-end px-(--mobile-chrome-gutter)">
        <Button
          class="pointer-events-auto"
          variant="secondary"
          size="lg"
          onClick={() =>
            fireAndForget(
              openChatWithAgent({
                type: 'document',
                id: props.callId,
                name: props.name,
                fileType: 'call',
              }),
              'call-recording'
            )
          }
        >
          <ChatWithAgentIcon class="size-5" />
          {t('channelComposer.askMacro')}
        </Button>
      </div>
    </FloatRegion>
  );
}
