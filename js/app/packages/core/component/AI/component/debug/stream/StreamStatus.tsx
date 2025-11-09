import type { MessageStream } from '@service-cognition/websocket';
import { Match, Switch } from 'solid-js';

type Props = {
  stream: () => MessageStream | undefined;
};

export function StreamStatus(props: Props) {
  console.log('status');
  return (
    <div class="p-2 bg-menu border border-edge text-ink font-mono space-y-2 text-sm">
      <Switch>
        <Match when={props.stream()}>
          {(stream) => (
            <div>
              Stream state
              <div class="flex items-center space-x-2">
                <span> chunks: {stream().data().length}</span>
              </div>
              <div class="flex items-center space-x-2">
                <Dot active={stream().isDone()} />
                <span>isDone: {String(stream().isDone())}</span>
              </div>
              <div class="flex items-center space-x-2">
                <Dot active={stream().isErr()} />
                <span>isErr: {String(stream().isErr())}</span>
              </div>
            </div>
          )}
        </Match>
        <Match when={!props.stream()}>
          <div>No Stream</div>
        </Match>
      </Switch>
    </div>
  );
}

function Dot(props: { active: boolean }) {
  return (
    <div
      class={`w-3 h-3 rounded-full border border-edge ${props.active ? 'bg-accent' : ''}`}
    />
  );
}
