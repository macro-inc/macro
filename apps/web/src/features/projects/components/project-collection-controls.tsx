import type { JSX } from 'solid-js';

/** Navigation stays fixed while the trailing search and filter controls expand. */
export function ProjectCollectionControls(props: {
  navigation?: JSX.Element;
  search: JSX.Element;
  filters: JSX.Element;
  actions: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex min-h-10 min-w-0 items-center justify-between gap-2">
        <div class="shrink-0">{props.navigation}</div>
        <div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {props.search}
          {props.filters}
        </div>
      </div>
      <div class="flex flex-wrap justify-end gap-2 empty:hidden">
        {props.actions}
      </div>
    </div>
  );
}
