import { cn } from '@ui';
import { For } from 'solid-js';

import type { PrRef } from '../util/prKey';
import { prDisplayName } from '../util/prKey';

export function SkeletonBar(props: { class?: string }) {
  return (
    <div
      class={cn('skeleton-shimmer rounded-full bg-edge-muted/50', props.class)}
    />
  );
}

function MessageSkeleton() {
  return (
    <div class="flex gap-2 py-3">
      <div class="animate-pulse size-6 rounded-full bg-edge-muted/50 shrink-0" />
      <div class="flex flex-col gap-2 grow min-w-0 pt-1">
        <SkeletonBar class="h-2.5 w-32" />
        <SkeletonBar class="h-2 w-full max-w-md" />
        <SkeletonBar class="h-2 w-3/4 max-w-sm" />
      </div>
    </div>
  );
}

export function PrTitleSkeleton() {
  return <SkeletonBar class="h-8 w-full max-w-xl" />;
}

export function PrMetadataSkeleton() {
  return (
    <div class="mb-6 flex flex-row flex-wrap items-center gap-2">
      <SkeletonBar class="h-6 w-20" />
      <SkeletonBar class="h-6 w-28" />
      <SkeletonBar class="h-6 w-36" />
      <SkeletonBar class="h-6 w-24" />
    </div>
  );
}

export function PrDescriptionSkeleton() {
  return (
    <div class="flex flex-col gap-2">
      <SkeletonBar class="h-2 w-full max-w-lg" />
      <SkeletonBar class="h-2 w-full max-w-md" />
      <SkeletonBar class="h-2 w-2/3 max-w-sm" />
    </div>
  );
}

export function PrTimelineSkeleton() {
  return (
    <section class="mt-8">
      <div class="flex items-center gap-2 pt-2">
        <div class="w-6 border-t border-edge-muted" />
        <span class="px-2 text-xs">Discussion</span>
        <div class="flex-1 border-t border-edge-muted" />
      </div>
      <div class="py-2">
        <For each={[0, 1, 2]}>{() => <MessageSkeleton />}</For>
      </div>
    </section>
  );
}

/**
 * Loading shell for the PR content column: the real title (derived from the
 * URL, no fetch needed) over pulsing pill and comment placeholders.
 */
export function PrContentSkeleton(props: { prRef: PrRef }) {
  return (
    <>
      <h1 class="ph-no-capture text-2xl font-semibold">
        {prDisplayName(props.prRef)}
      </h1>
      <div class="spacer h-3" />
      <PrMetadataSkeleton />
      <PrDescriptionSkeleton />
      <PrTimelineSkeleton />
    </>
  );
}
