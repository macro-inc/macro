import type { ChannelData } from '@block-channel/definition';
import {
  doesChannelRequireJoin,
  isValidChannelData,
} from '@block-channel/signal/channel';
import { channelBlockDataSignal } from '@block-channel/signal/channelBlockData';
import { useChannelName } from '@core/component/ChannelsProvider';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { commsServiceClient } from '@service-comms/client';
import { useUserId } from '@service-gql/client';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSXElement,
  Match,
  Switch,
} from 'solid-js';
import { Channel } from './Channel';
import { JoinChannelDialog } from './JoinChannelDialog';

export function WithTopBar(props: { children: JSXElement }) {
  return <div>{props.children}</div>;
}

export type JoinState = 'REQUIRED' | 'NOT_REQUIRED';

export default function BlockChannel() {
  const blockData = channelBlockDataSignal.get;
  const userId = useUserId();

  const [error] = createSignal<string>();
  const [joinState, setJoinState] = createSignal<JoinState>();
  const [validChannelData, setValidChannelData] =
    createSignal<Required<ChannelData>>();

  createEffect(() => {
    const blockData_ = blockData();
    const userId_ = userId();
    if (!userId_) return;
    if (!blockData_) return;
    if (!isValidChannelData(blockData_)) return;

    setJoinState(
      doesChannelRequireJoin(blockData_, userId_) ? 'REQUIRED' : 'NOT_REQUIRED'
    );

    setValidChannelData(blockData_);
  });

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

  const channelName = createMemo(() => {
    const data = blockData();
    if (!data) return undefined;
    const id = data.channel.id;
    const name = data.channel.name;
    const maybeChannelName = useChannelName(id, name as string);
    return maybeChannelName();
  });

  return (
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
          {(channelData) => <Channel data={channelData()} />}
        </Match>
      </Switch>
    </DocumentBlockContainer>
  );
}
