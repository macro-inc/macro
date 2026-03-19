import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function ComposersPreviewContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Macro has dedicated composers for tasks, emails, and more — each
        tailored to its content type.
      </p>
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 150ms both' }}
      >
        Open any item to start editing with the right tools built in.
      </p>
    </div>
  );
}

function ComposersPreviewDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center gap-4 px-6">
      {/* Task composer wireframe */}
      <div class="flex-1 max-w-xs rounded-sm border border-edge-muted bg-panel flex flex-col overflow-hidden">
        <div class="px-3 py-2 border-b border-edge-muted">
          <div class="h-4 w-24 bg-ink/10 rounded-xs" />
        </div>
        <div class="px-3 py-3 flex flex-col gap-2">
          {/* Property grid skeleton */}
          <div class="flex items-center gap-2">
            <div class="h-3 w-12 bg-ink/8 rounded-xs" />
            <div class="h-3 w-20 bg-ink/8 rounded-xs" />
          </div>
          <div class="flex items-center gap-2">
            <div class="h-3 w-12 bg-ink/8 rounded-xs" />
            <div class="h-3 w-16 bg-ink/8 rounded-xs" />
          </div>
          <div class="flex items-center gap-2">
            <div class="h-3 w-12 bg-ink/8 rounded-xs" />
            <div class="h-3 w-24 bg-ink/8 rounded-xs" />
          </div>
        </div>
        <div class="flex-1 px-3 py-3 border-t border-edge-muted">
          <div class="h-3 w-full bg-ink/5 rounded-xs mb-2" />
          <div class="h-3 w-3/4 bg-ink/5 rounded-xs mb-2" />
          <div class="h-3 w-1/2 bg-ink/5 rounded-xs" />
        </div>
        <div class="px-3 py-2 text-[10px] text-ink/30 text-center">Task</div>
      </div>

      {/* Email composer wireframe */}
      <div class="flex-1 max-w-xs rounded-sm border border-edge-muted bg-panel flex flex-col overflow-hidden">
        <div class="px-3 py-2 border-b border-edge-muted flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-ink/30 w-6">To</span>
            <div class="h-3 flex-1 bg-ink/8 rounded-xs" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-ink/30 w-6">Subj</span>
            <div class="h-3 flex-1 bg-ink/8 rounded-xs" />
          </div>
        </div>
        <div class="flex-1 px-3 py-3">
          <div class="h-3 w-full bg-ink/5 rounded-xs mb-2" />
          <div class="h-3 w-4/5 bg-ink/5 rounded-xs mb-2" />
          <div class="h-3 w-2/3 bg-ink/5 rounded-xs" />
        </div>
        <div class="px-3 py-2 border-t border-edge-muted flex justify-end">
          <div class="h-6 w-14 bg-accent/20 rounded-xs" />
        </div>
        <div class="px-3 py-2 text-[10px] text-ink/30 text-center">Email</div>
      </div>
    </div>
  );
}

export const composersPreviewLesson: LessonDefinition = {
  id: 'composers-preview',
  title: 'Composers',
  subtitle: 'Purpose-built editors for every content type.',
  content: ComposersPreviewContent,
  demo: ComposersPreviewDemo,
  order: 60,
};
