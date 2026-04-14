import { For } from 'solid-js';
import { AttachmentSection } from './SectionHeader';

export function ThumbnailSkeleton() {
  return (
    <div class="size-23 rounded-2xl border border-edge bg-edge/50 animate-pulse" />
  );
}

export function DocumentRowSkeleton() {
  return (
    <div class="flex items-center gap-2 min-h-10 px-2">
      <div class="size-4 rounded bg-edge/50 animate-pulse shrink-0" />
      <div class="h-3.5 rounded bg-edge/50 animate-pulse w-48" />
      <div class="flex-1" />
      <div class="h-3 w-16 rounded bg-edge/50 animate-pulse shrink-0" />
      <div class="h-3 w-12 rounded bg-edge/50 animate-pulse shrink-0" />
    </div>
  );
}

const MEDIA_SKELETON_COUNT = 6;
const DOCUMENT_SKELETON_COUNT = 6;

export function MediaGallerySkeleton() {
  return (
    <AttachmentSection label="Photos and videos">
      <div class="flex flex-row flex-wrap gap-1.5">
        <For each={Array.from({ length: MEDIA_SKELETON_COUNT })}>
          {() => <ThumbnailSkeleton />}
        </For>
      </div>
    </AttachmentSection>
  );
}

export function AttachmentEntityListSkeleton() {
  return (
    <AttachmentSection label="Documents">
      <For each={Array.from({ length: DOCUMENT_SKELETON_COUNT })}>
        {() => <DocumentRowSkeleton />}
      </For>
    </AttachmentSection>
  );
}
