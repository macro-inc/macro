import { cn } from '@ui';

interface DashboardSectionLoadingProps {
  rows?: number;
  class?: string;
}

export function DashboardSectionLoading(props: DashboardSectionLoadingProps) {
  const rowCount = () => props.rows ?? 3;

  return (
    <div class={cn('flex flex-col gap-3', props.class)}>
      {Array.from({ length: rowCount() }).map(() => (
        <div class="flex items-center gap-3">
          <div class="size-9 rounded-lg bg-ink/5 animate-pulse shrink-0" />
          <div class="flex-1 space-y-2">
            <div class="h-3.5 bg-ink/5 rounded animate-pulse w-3/4" />
            <div class="h-2.5 bg-ink/5 rounded animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
