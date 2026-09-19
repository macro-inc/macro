/**
 * A one-line explanation above the composer for a wait the transcript cannot
 * show.
 *
 * The case it exists for: acting on a session whose sandbox was reaped for
 * idleness. The service resumes the container before it can deliver anything,
 * which takes as long as a cold start, and nothing is written to the session
 * log until it lands — so the transcript stays empty, the pill still says
 * "Disconnected", and the block otherwise looks like it ignored the click.
 */

import { TextShimmer } from './TextShimmer';

export interface ComposerNoticeProps {
  text: string;
  /** Shimmer the text: something is happening, not merely stated. */
  active?: boolean;
}

export function ComposerNotice(props: ComposerNoticeProps) {
  return (
    <div class="flex items-center gap-2 pb-2 text-xs text-ink-extra-muted">
      <TextShimmer text={props.text} active={props.active ?? false} />
    </div>
  );
}
