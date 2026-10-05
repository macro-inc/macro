import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { For, Show } from 'solid-js';
import type { ProjectSection } from '../core/project';

export function ProjectDescriptionSkeleton() {
  return (
    <ListSkeleton.Root label="Loading project description" class="min-h-24">
      <div class="space-y-3 pt-1.5">
        <ListSkeleton.Bar class="w-4/5 max-w-lg opacity-60" />
        <ListSkeleton.Bar class="w-3/5 max-w-md opacity-60" />
        <ListSkeleton.Bar class="w-2/5 max-w-sm opacity-60" />
      </div>
    </ListSkeleton.Root>
  );
}

export function ProjectsSidebarSkeleton() {
  return (
    <ListSkeleton.Root label="Loading projects">
      <For each={[0, 1, 2, 3]}>
        {() => (
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
            <ListSkeleton.Bar class="w-28 max-w-full" />
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** Matches the overview's content width, insets, and wrapping property pills. */
export function ProjectContentSkeleton(props: { section: ProjectSection }) {
  return (
    <ListSkeleton.Root label="Loading project" class="h-full overflow-y-auto">
      <Show
        when={props.section === 'overview'}
        fallback={<ProjectTasksSkeleton />}
      >
        <div class="px-6 pb-8 pt-12 touch:pt-6">
          <div class="mx-auto max-w-3xl">
            <ListSkeleton.Bar class="h-8 w-72 max-w-full rounded-lg" />
            <div class="mb-6 mt-3 flex flex-wrap items-center gap-2">
              <ListSkeleton.Bar class="h-6 w-28" />
              <ListSkeleton.Bar class="h-6 w-24" />
              <ListSkeleton.Bar class="h-6 w-20" />
              <ListSkeleton.Bar class="h-6 w-28" />
            </div>
            <div class="mt-1.5 min-h-24 space-y-3 pt-1">
              <ListSkeleton.Bar class="w-full max-w-lg" />
              <ListSkeleton.Bar class="w-4/5 max-w-md" />
              <ListSkeleton.Bar class="w-3/5 max-w-sm" />
            </div>
            <div class="mt-6 space-y-5">
              <ListSkeleton.Bar class="w-24" />
              <div class="flex gap-3">
                <ListSkeleton.Bar class="size-7 shrink-0" />
                <div class="min-w-0 flex-1 space-y-3">
                  <ListSkeleton.Bar class="w-36 max-w-full" />
                  <ListSkeleton.Bar class="w-2/3 max-w-sm" />
                </div>
              </div>
              <ListSkeleton.Bar class="h-12 w-full" />
            </div>
          </div>
        </div>
      </Show>
    </ListSkeleton.Root>
  );
}

function ProjectTasksSkeleton() {
  return (
    <div class="space-y-6 p-3 touch:px-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <ListSkeleton.Bar class="h-10 w-96 max-w-full" />
        <div class="flex gap-2">
          <ListSkeleton.Bar class="h-8 w-32" />
          <ListSkeleton.Bar class="h-8 w-24" />
        </div>
      </div>
      <ListSkeleton.Bar class="h-7 w-full rounded-lg" />
      <For each={[0, 1, 2, 3]}>
        {() => (
          <div class="flex items-center gap-4 px-3">
            <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="ml-auto h-5 w-20" />
            <ListSkeleton.Bar class="h-5 w-24 touch:hidden" />
          </div>
        )}
      </For>
    </div>
  );
}
