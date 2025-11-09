import { IconButton } from '@core/component/IconButton';
import { Bar } from '@core/component/TopBar/Bar';
import { Left } from '@core/component/TopBar/Left';
import { Right } from '@core/component/TopBar/Right';
import { isOk } from '@core/util/maybeResult';
import EnvelopeSimple from '@icon/regular/envelope-simple.svg?component-solid';
import PaperPlaneRight from '@icon/regular/paper-plane-right.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { Show } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';

export function TopBar(props: { email: string; type: 'person' | 'company' }) {
  const handleEmailClick = () => {
    replaceOrInsertSplit({ type: 'email', id: 'new' });
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const handleDMClick = async () => {
    // Convert email to user ID format (prepend 'macro|')
    const userId = `macro|${props.email}`;

    // Get or create DM channel
    const result = await commsServiceClient.getOrCreateDirectMessage({
      recipient_id: userId,
    });

    if (isOk(result) && result[1]?.channel_id) {
      replaceOrInsertSplit({
        type: 'channel',
        id: result[1].channel_id,
      });
    }
  };

  return (
    <Bar
      left={<Left />}
      center
      right={
        <Right>
          <div class="flex items-center gap-2">
            <IconButton
              icon={EnvelopeSimple}
              title="Send Email"
              onClick={handleEmailClick}
            />
            <Show when={props.type === 'person'}>
              <IconButton
                icon={PaperPlaneRight}
                title="Send Direct Message"
                onClick={handleDMClick}
              />
            </Show>
          </div>
        </Right>
      }
    />
  );
}
