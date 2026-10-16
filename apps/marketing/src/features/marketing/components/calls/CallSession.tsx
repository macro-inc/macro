import { createSignal } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { CallOverlayView, type RemoteTile } from './CallOverlay';
import type { CallPerson } from './call-fixtures';

/** The local side of one live call: devices, chat, and who has joined. */
export function createCallSession(
  initial: RemoteTile[],
  initialChat: WorkspaceComment[] = [],
  you: CallPerson = 'jacob'
) {
  const [joined, setJoined] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [remote, setRemote] = createSignal(initial);
  const [muted, setMuted] = createSignal(false);
  const [chatOpen, setChatOpen] = createSignal(false);
  const [chat, setChat] = createSignal<WorkspaceComment[]>(initialChat);
  return {
    chat,
    joined,
    setJoined: (value: boolean) => {
      setJoined(value);
    },
    connecting,
    setConnecting: (value: boolean) => {
      setConnecting(value);
    },
    remote,
    setRemote: (value: RemoteTile[]) => {
      setRemote(value);
    },
    view: (props: { onLeave: () => void; time: string }) => (
      <div class="call-tab-body">
        <CallOverlayView
          remote={remote()}
          you={you}
          connecting={connecting()}
          muted={muted()}
          chatOpen={chatOpen()}
          chat={chat()}
          onMute={() => setMuted(!muted())}
          onChat={() => setChatOpen(!chatOpen())}
          onSendChat={(body) =>
            setChat((list) => [
              ...list,
              {
                id: `chat-${list.length}`,
                person: you,
                body,
                time: props.time,
              },
            ])
          }
          onLeave={() => {
            setJoined(false);
            setChatOpen(false);
            props.onLeave();
          }}
        />
      </div>
    ),
  };
}
