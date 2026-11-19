import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { cn } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import type { JSX } from 'solid-js';
import { groupIcon } from './group-icon';

/**
 * One group in the permissions card: a header button (icon tile, name and
 * summary, caret) that opens the group's action and tool rows.
 */
export function PermissionGroupRow(props: {
  groupId: string;
  name: JSX.Element;
  summary: JSX.Element;
  open: boolean;
  onToggle: () => void;
  children: JSX.Element;
}) {
  const bodyId = () => `agent-permissions-group-${props.groupId}`;
  const Icon = groupIcon(props.groupId);

  return (
    <div data-permission-group={props.groupId}>
      <h3>
        <button
          type="button"
          aria-expanded={props.open}
          aria-controls={bodyId()}
          class="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none not-touch:hover:bg-ink/[0.025] focus-visible:bg-ink/4"
          onClick={() => props.onToggle()}
        >
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-muted">
            <Icon aria-hidden="true" class="size-4" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-medium text-ink">{props.name}</span>
            {props.summary}
          </span>
          <CaretDownIcon
            aria-hidden="true"
            class={cn(
              'size-4 shrink-0 text-ink-extra-muted transition-transform',
              props.open && 'rotate-180'
            )}
          />
        </button>
      </h3>
      <CollapseTransition open={props.open}>
        <div
          id={bodyId()}
          class="@container/permission-group px-4 pb-4 @min-[520px]/settings-page:pl-15"
        >
          {props.children}
        </div>
      </CollapseTransition>
    </div>
  );
}
