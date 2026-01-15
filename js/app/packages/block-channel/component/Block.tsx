import {
  doesChannelRequireJoin,
  initializeChannelData,
  isValidChannelData,
} from '@block-channel/signal/channel';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useChannelQuery } from '@queries/channel/channel';
import { commsServiceClient } from '@service-comms/client';
import { useUserId } from '@service-gql/client';
import {
  createSignal,
  type JSXElement,
  Match,
  Suspense,
  Switch,
} from 'solid-js';
import { Channel } from './Channel';
import { JoinChannelDialog } from './JoinChannelDialog';
import type { TargetMessageInfo } from './MessageList/MessageList';

export function WithTopBar(props: { children: JSXElement }) {
  return <div>{props.children}</div>;
}

export type JoinState = 'REQUIRED' | 'NOT_REQUIRED';

export type BlockChannelProps = {
  target?: TargetMessageInfo;
};

export default function BlockChannel(props: BlockChannelProps) {
  const channelId = useBlockId();

  const channel = useChannelQuery(
    () => channelId,
    () => ({
      placeholderData: (p) => p,
    })
  );
  const userId = useUserId();

  const [error] = createSignal<string>();
  const [joinState, setJoinState] = createSignal<JoinState>();

  const validChannelData = () => {
    const blockData_ = channel.data;
    const userId_ = userId();
    if (!userId_) return;
    if (!blockData_) return;
    if (!isValidChannelData(blockData_)) return;

    initializeChannelData(blockData_);
    setJoinState(
      doesChannelRequireJoin(blockData_, userId_) ? 'REQUIRED' : 'NOT_REQUIRED'
    );

    return blockData_;
  };

  function handleJoinChannel(
    channelId: string,
    selection: 'ACCEPTED' | 'REJECTED'
  ) {
    if (selection === 'ACCEPTED') {
      commsServiceClient
        .joinChannel({
          channel_id: channelId,
        })
        .then(() => {
          setJoinState('NOT_REQUIRED');
        });
      setJoinState('NOT_REQUIRED');
    } else {
      setJoinState('REQUIRED');
    }
  }

  const validChannelDataWithJoinState = () => {
    if (joinState() === 'REQUIRED' && validChannelData()) {
      let data = validChannelData();
      return data;
    }
    return undefined;
  };

  const channelName = () => {
    const data = channel.data;
    if (!data) return undefined;
    const id = data.channel.id;
    const name = data.channel.name;
    const maybeChannelName = useChannelName(id, name as string);
    return maybeChannelName();
  };

  return (
    <Suspense>
      <DocumentBlockContainer title={channelName() ?? 'Channel'}>
        <Switch
          fallback={
            <WithTopBar>
              <h1 />
            </WithTopBar>
          }
        >
          <Match when={error()}>
            <WithTopBar>
              <h1>{error()}</h1>
            </WithTopBar>
          </Match>
          <Match when={validChannelDataWithJoinState()}>
            {(channelData) => (
              <WithTopBar>
                <JoinChannelDialog
                  channelName={channelData().channel.name ?? ''}
                  participantCount={channelData().participants.length}
                  onSelect={(selection) =>
                    handleJoinChannel(channelData().channel.id, selection)
                  }
                />
              </WithTopBar>
            )}
          </Match>
          <Match when={validChannelData()}>
            {(channelData) => (
              <Channel data={channelData()} target={props.target} />
            )}
          </Match>
        </Switch>
      </DocumentBlockContainer>
    </Suspense>
  );
}
