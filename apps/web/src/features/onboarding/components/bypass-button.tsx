import { Button } from '@ui';

/** Signup and onboarding escape hatch, pinned to the corner over each step. */
export function BypassButton(props: {
  disabled: boolean;
  onBypass: () => void;
}) {
  return (
    <div class="absolute top-4 right-4 z-30">
      <Button
        variant="ghost"
        size="sm"
        class="text-ink-muted"
        disabled={props.disabled}
        onClick={() => props.onBypass()}
      >
        Bypass
      </Button>
    </div>
  );
}
