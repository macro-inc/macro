import ArrowUpIcon from '@icon/regular/arrow-up.svg';
import CalendarBlankIcon from '@icon/regular/calendar-blank.svg';

import CheckIcon from '@icon/regular/check.svg';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
import ClockIcon from '@icon/regular/clock.svg';
import FlagIcon from '@icon/regular/flag.svg';
import PaperclipIcon from '@icon/regular/paperclip.svg';
import PlusIcon from '@icon/regular/plus.svg';
import TextAaIcon from '@icon/regular/text-aa.svg';
import UsersIcon from '@icon/regular/users.svg';
import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function ComposersPreviewContent(props: LessonContentProps) {
  onMount(() => setTimeout(() => props.onComplete('Got it')));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro has dedicated composers for tasks, emails, and more — each
        tailored to its content type.
      </p>
      <p>Open any item to start editing with the right tools built in.</p>
    </div>
  );
}

function ComposersPreviewDemo() {
  return (
    <div class="size-full flex flex-col items-center justify-center gap-6 px-10 py-8">
      {/* Task composer */}
      <div class="w-full max-w-lg rounded-sm border border-edge-muted bg-panel flex flex-col overflow-hidden">
        <div class="px-4 pt-3 pb-1">
          <div class="flex items-center gap-2">
            <div class="size-5 rounded-xs bg-task-bg flex items-center justify-center">
              <CheckIcon class="size-3 text-task" />
            </div>
            <span class="text-lg text-ink/40">Task Title</span>
          </div>
          <p class="text-xs text-ink/30 mt-1 pl-7">Add description...</p>
        </div>

        {/* Properties grid */}
        <div class="px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px]">
          <div class="flex items-center gap-1.5">
            <UsersIcon class="size-3.5 text-ink/50" />
            <span class="text-ink/50">Assignees</span>
            <span class="bg-accent/15 text-accent text-xxs px-1.5 py-0.5 rounded-xs font-medium">
              seam
            </span>
            <PlusIcon class="size-3 text-ink/30" />
          </div>
          <div class="flex items-center gap-1.5">
            <CircleDashedIcon class="size-3.5 text-ink/50" />
            <span class="text-ink/50">Status</span>
            <span class="text-ink/50 border border-edge-muted px-1.5 py-0.5 rounded-xs">
              Not Started
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <CalendarBlankIcon class="size-3.5 text-ink/50" />
            <span class="text-ink/50">Due Date</span>
            <span class="text-ink/30 border border-edge-muted px-1.5 py-0.5 rounded-xs">
              Empty
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <FlagIcon class="size-3.5 text-ink/50" />
            <span class="text-ink/50">Priority</span>
            <PlusIcon class="size-3 text-ink/30" />
          </div>
        </div>

        {/* Footer */}
        <div class="px-4 py-2 border-t border-edge-muted flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-[11px] text-ink/40">
            <span>Create More</span>
            <div class="w-6 h-3.5 rounded-full bg-ink/10" />
          </div>
          <div class="flex items-center gap-1 text-[11px] text-ink/40 border border-edge-muted px-2.5 py-1 rounded-xs">
            <CheckIcon class="size-3" />
            <span>Create Task</span>
          </div>
        </div>
      </div>

      {/* Email composer */}
      <div class="w-full max-w-lg rounded-sm border border-edge-muted bg-panel flex flex-col overflow-hidden">
        {/* From line */}
        <div class="px-4 py-2.5 flex items-center justify-between text-xs">
          <span class="text-ink/40">from seamus@macro.com</span>
          <div class="flex items-center gap-2 text-ink/50">
            <span>+ Cc</span>
            <span>+ Bcc</span>
          </div>
        </div>

        {/* To field */}
        <div class="px-4 py-2 flex items-center gap-3">
          <span class="text-sm text-ink/40">To</span>
          <span class="text-sm text-ink/30">
            Macro users or email addresses
          </span>
        </div>
        <div class="mx-4 h-px bg-email" />

        {/* Subject field */}
        <div class="px-4 py-2 flex items-center gap-3">
          <span class="text-sm text-ink/40">Subject</span>
          <span class="text-sm text-ink/30">Subject</span>
        </div>
        <div class="mx-4 h-px bg-edge-muted" />

        {/* Body */}
        <div class="p-4 flex-1 min-h-20">
          <span class="text-sm text-ink/25">Use `@` to reference files</span>
        </div>

        {/* Footer */}
        <div class="px-4 py-2.5 border-t border-edge-muted flex items-center justify-between">
          <div class="flex items-center gap-3 text-ink/40">
            <PaperclipIcon class="size-4" />
            <TextAaIcon class="size-4" />
            <ClockIcon class="size-4" />
          </div>
          <div class="size-7 rounded-full border-2 border-email flex items-center justify-center">
            <ArrowUpIcon class="size-3.5 text-email" />
          </div>
        </div>
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
