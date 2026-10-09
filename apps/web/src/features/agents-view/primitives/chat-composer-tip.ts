import { createMediaQuery } from '@solid-primitives/media';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const TIPS = [
  'Connect your apps in Agents → Connections',
  'Type / to add a skill',
  'Type @ to mention docs, people, or channels',
  'Choose an agent to change who helps',
];

/** Type each hint, pause to read it, then erase quickly before the next hint. */
export function createChatComposerTip(
  empty: Accessor<boolean>,
  canChooseAgent = true
) {
  const tips = canChooseAgent
    ? TIPS
    : [TIPS[0], 'Use @ to reference a skill document', TIPS[2]];
  const reducedMotion = createMediaQuery('(prefers-reduced-motion: reduce)');
  const [text, setText] = createSignal('');
  let index = 0;
  let length = 0;
  let deleting = false;
  let delay = 300;

  // A timer is external state: start and stop it with the visible empty input.
  createEffect(() => {
    if (!empty() || reducedMotion()) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (nextDelay: number) => {
      delay = nextDelay;
      timer = setTimeout(advance, delay);
    };
    const advance = () => {
      const tip = tips[index];
      if (deleting) {
        length = Math.max(0, length - 2);
        setText(tip.slice(0, length));
        if (length === 0) {
          index = (index + 1) % tips.length;
          deleting = false;
          schedule(300);
        } else schedule(12);
      } else {
        length += 1;
        setText(tip.slice(0, length));
        if (length === tip.length) {
          deleting = true;
          schedule(2200);
        } else schedule(32);
      }
    };
    schedule(delay);
    onCleanup(() => clearTimeout(timer));
  });
  return () => (reducedMotion() ? tips[0] : text());
}
