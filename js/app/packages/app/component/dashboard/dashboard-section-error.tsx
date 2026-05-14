import RefreshIcon from '@icon/regular/arrow-clockwise.svg';
import { Button } from '@ui';

interface DashboardSectionErrorProps {
  error: Error;
  reset: () => void;
  title?: string;
}

export function DashboardSectionError(props: DashboardSectionErrorProps) {
  return (
    <div class="flex flex-col items-center justify-center py-8 px-4 text-center">
      <p class="text-sm text-failure-ink mb-2">
        {props.title ? `Failed to load ${props.title}` : 'Something went wrong'}
      </p>
      <p class="text-xs text-ink-muted mb-4 max-w-80 break-words">
        {props.error.message}
      </p>
      <Button variant="ghost" onClick={props.reset} class="gap-1.5">
        <RefreshIcon class="size-3.5" />
        Try again
      </Button>
    </div>
  );
}
