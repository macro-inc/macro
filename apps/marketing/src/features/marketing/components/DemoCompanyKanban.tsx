import { cn } from '@ui';
import { Layer } from '@ui/components/Layer';
import { type JSX, splitProps } from 'solid-js';

/** Shared CRM column chrome; the host owns data, permissions and drag events. */
export function CompanyKanbanColumn(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    icon: JSX.Element;
    label: string;
    highlighted?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'icon',
    'label',
    'highlighted',
    'class',
    'children',
  ]);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-full min-w-56 flex-1 flex-col rounded-xl bg-surface-2/30 transition-colors',
        local.highlighted && 'bg-accent/10',
        local.class
      )}
    >
      <div class="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ink-muted">
        {local.icon}
        <span class="truncate">{local.label}</span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden flex flex-col gap-2 px-2 pb-2">
        {local.children}
      </div>
    </div>
  );
}

/** CRM card presentation, with identity and metadata supplied by the host. */
export function CompanyKanbanCardSurface(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'title'> & {
    icon: JSX.Element;
    title: JSX.Element;
    owner?: JSX.Element;
    domain?: JSX.Element;
    updatedAt?: JSX.Element;
    dragging?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'icon',
    'title',
    'owner',
    'domain',
    'updatedAt',
    'dragging',
    'class',
  ]);
  return (
    <Layer depth={2}>
      <div
        {...rest}
        class={cn(
          'flex flex-col gap-1.5 rounded-lg bg-surface p-2.5 text-sm shadow-sm',
          'hover:bg-hover hover:shadow-md transition-[background-color,box-shadow]',
          local.dragging && 'opacity-40',
          local.class
        )}
      >
        <div class="flex items-center gap-2 min-w-0">
          <div class="size-4 shrink-0">{local.icon}</div>
          <span class="ph-no-capture truncate font-semibold min-w-0">
            {local.title}
          </span>
          {local.owner}
        </div>
        <div class="flex items-center gap-2 min-w-0 text-xs text-ink-extra-muted">
          {local.domain}
          {local.updatedAt}
        </div>
      </div>
    </Layer>
  );
}
