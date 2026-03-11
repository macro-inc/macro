import { createSignal, type Accessor } from 'solid-js';

export function createTargetMessageControlledSignal(
  _channelId: Accessor<string>,
  initialTargetMessageId: string | undefined
) {
  const [targetMessageId, setTargetMessageId] = createSignal<
    string | undefined
  >(initialTargetMessageId);

  return [targetMessageId, setTargetMessageId];
}
