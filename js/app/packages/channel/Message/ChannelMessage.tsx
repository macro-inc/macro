import type { MessageData } from './types';
import { Root } from './Root';
import { Layout } from './Layout';
import { SenderName } from './SenderName';
import { SenderIcon } from './SenderIcon';
import { Timestamp } from './Timestamp';
import { Content } from './Content';
import { Reactions } from './Reactions';
import { EditedIndicator } from './EditedIndicator';

type ChannelMessageProps = {
  message: MessageData;
};

export function ChannelMessage(props: ChannelMessageProps) {
  return (
    <Root message={props.message}>
      <Layout>
        <div class="flex items-start gap-2">
          <SenderIcon />
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <SenderName />
              <EditedIndicator />
              <Timestamp class="ml-auto" />
            </div>
            <Content />
            <Reactions />
          </div>
        </div>
      </Layout>
    </Root>
  );
}
