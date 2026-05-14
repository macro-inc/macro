import RefreshIcon from '@icon/regular/arrow-clockwise.svg';
import WarningIcon from '@icon/regular/warning.svg';
import { Button } from '@ui';

interface DashboardSectionErrorProps {
  error: Error;
  reset: () => void;
  title?: string;
}

export function DashboardSectionError(props: DashboardSectionErrorProps) {
  return (
    <div class="flex flex-col items-center justify-center py-6 text-center">
      <div class="size-10 rounded-full bg-failure/10 flex items-center justify-center mb-3 text-failure [&_svg]:size-5">
        <WarningIcon />
      </div>
      <p class="text-sm text-ink-muted font-medium">
        {props.title ? `Failed to load ${props.title}` : 'Something went wrong'}
      </p>
      <p class="text-xs text-ink-extra-muted mt-1 max-w-56 break-words">
        {props.error.message}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.reset}
        class="mt-4 gap-1.5"
      >
        <RefreshIcon class="size-3.5" />
        Try again
      </Button>
    </div>
  );
}
