import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

const TIPS = [
  'Connect your apps in Settings → Connections',
  'Type / to add a skill',
  'Type @ to mention docs, people, or channels',
  'Choose an agent to change who helps',
];

/** Cycle one hint at a time, pausing while the user has a draft. */
export function createChatComposerTip(
  empty: Accessor<boolean>,
  canChooseAgent = true
) {
  const tips = canChooseAgent
    ? TIPS
    : [TIPS[0], 'Use @ to reference a skill document', TIPS[2]];
  const [index, setIndex] = createSignal(0);
  onMount(() => {
    const interval = setInterval(() => {
      if (empty()) setIndex((current) => (current + 1) % tips.length);
    }, 6000);
    onCleanup(() => clearInterval(interval));
  });
  return () => tips[index()];
}
