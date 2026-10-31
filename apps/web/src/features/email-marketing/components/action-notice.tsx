import { Button } from '@ui';

/** A problem across the workspace that one action resolves. */
export function ActionNotice(props: {
  message: string;
  action: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-failure/5 px-4 py-2 text-xs text-ink">
      {props.message}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={props.disabled}
        onClick={() => props.onAction()}
      >
        {props.action}
      </Button>
    </div>
  );
}
