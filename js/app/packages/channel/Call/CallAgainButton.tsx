import PhoneCallIcon from '@macro-icons/wide/call.svg';
import { useCall } from './use-call';

export function CallAgainButton(props: { channelId: string; class?: string }) {
  const call = useCall(() => props.channelId);
  return (
    <button
      type="button"
      class={props.class}
      disabled={call.isJoining()}
      title="Call again"
      onClick={(e) => {
        e.stopPropagation();
        void call.joinCall();
      }}
    >
      <PhoneCallIcon class="size-4 shrink-0" />
      Call again
    </button>
  );
}
