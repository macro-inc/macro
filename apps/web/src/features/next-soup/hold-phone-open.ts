import { preloadComponent, withinBudget } from '@app/lib/split-router';
import { prefetchChannelTarget } from '@channel/queries/prefetch-channel-target';
import type { BlockName } from '@core/block';
import { blocks } from '@core/constant/allBlocks';
import type { ChannelClickTarget } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { messageTimelineQueryOptions } from '@queries/messages/timeline';

/** Longest a pressed row waits before its pane opens on a loading view. */
export const PHONE_OPEN_HOLD_MAX_MS = 500;

// Only the newest tap may open: a later tap replaces an earlier one.
let latestTap = 0;

/** Claims the newest phone tap. Call it before the tap's first await. */
export function claimPhoneOpenTap(): number {
  return ++latestTap;
}

function isBlockName(type: string): type is BlockName {
  return type in blocks;
}

function warmChannelMessages(
  channelId: string,
  target: ChannelClickTarget | undefined
): Promise<void> {
  if (target?.kind === 'message') {
    return prefetchChannelTarget(channelId, target);
  }
  return queryClient.prefetchInfiniteQuery(
    messageTimelineQueryOptions({ type: 'channel', id: channelId }, null)
  );
}

async function settleAll(work: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(work);
}

function holdOutcome(
  hold: { tap: number; isSourceUnchanged: () => boolean },
  ready: boolean
) {
  if (hold.tap !== latestTap) return 'superseded';
  if (!hold.isSourceUnchanged()) return 'source_changed';
  return ready ? 'ready' : 'timeout';
}

/**
 * Keeps a phone's pressed row highlighted while the destination's code and
 * first data load, so the pane slides in with content instead of a loading
 * view. Waits at most {@link PHONE_OPEN_HOLD_MAX_MS}; after that the pane opens
 * on its own loading state. Resolves `false` when a later tap replaced `tap`
 * or the source pane changed, in which case the caller must not open anything.
 */
export async function holdPhoneOpenUntilReady(hold: {
  content: { type: string; id: string };
  channelTarget: ChannelClickTarget | undefined;
  tap: number;
  isSourceUnchanged: () => boolean;
}): Promise<boolean> {
  const { content, channelTarget } = hold;
  return await Telemetry.span('soup.open.hold', async (span) => {
    span.setAttr('entity.type', content.type);
    span.setAttr('entity.id', content.id);
    const work = [
      isBlockName(content.type)
        ? preloadComponent(blocks[content.type].component)
        : undefined,
      content.type === 'channel'
        ? warmChannelMessages(content.id, channelTarget)
        : undefined,
    ].filter((promise) => promise !== undefined);
    let ready = false;
    await withinBudget(
      (async () => {
        await settleAll(work);
        ready = true;
      })(),
      PHONE_OPEN_HOLD_MAX_MS
    );
    const outcome = holdOutcome(hold, ready);
    span.setAttr('soup.open.hold.outcome', outcome);
    return outcome === 'ready' || outcome === 'timeout';
  });
}
