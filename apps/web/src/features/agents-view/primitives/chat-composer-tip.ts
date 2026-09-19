const TIPS: readonly string[] = [
  'Connect your apps in Settings → Connections',
  'Type / to add a skill',
  'Type @ to mention docs, people, or channels',
  'Choose an agent to change who helps',
];

/** Hints the empty composer types out one at a time, in order. */
export function chatComposerTips(canChooseAgent = true): readonly string[] {
  return canChooseAgent
    ? TIPS
    : [TIPS[0], 'Use @ to reference a skill document', TIPS[2]];
}
