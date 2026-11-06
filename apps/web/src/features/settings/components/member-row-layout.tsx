import type { JSX } from 'solid-js';

/** The roster uses one grid for both account kinds, including on phones. */
export function MemberRowLayout(props: {
  kind: 'human' | 'agent';
  avatar: JSX.Element;
  name: JSX.Element;
  detail: JSX.Element;
  status: JSX.Element;
  actions: JSX.Element;
}) {
  return (
    <div
      data-member-kind={props.kind}
      class="grid h-20 grid-cols-[minmax(0,1fr)_4.5rem_1.5rem] sm:grid-cols-[minmax(0,1fr)_8rem_2rem] items-center gap-2 sm:gap-3 px-3 sm:px-4"
    >
      <div
        class="flex items-center gap-2 sm:gap-3 min-w-0"
        data-member-identity
      >
        <div class="relative shrink-0">{props.avatar}</div>
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {props.name}
          </div>
          <div class="min-w-0 h-5 flex items-center gap-2 text-xs text-ink-muted">
            {props.detail}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 items-center justify-end" data-member-status>
        {props.status}
      </div>
      <div class="flex items-center justify-end" data-member-actions>
        {props.actions}
      </div>
    </div>
  );
}
