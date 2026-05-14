import { cn } from '@ui';

interface DashboardSectionLoadingProps {
  lines?: number;
  class?: string;
}

export function DashboardSectionLoading(props: DashboardSectionLoadingProps) {
  const lineCount = () => props.lines ?? 3;

  return (
    <div class={cn('flex flex-col gap-3 py-4', props.class)}>
      {Array.from({ length: lineCount() }).map((_, i) => (
        <div
          class="h-4 bg-ink/5 rounded animate-pulse"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
