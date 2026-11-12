import { Checkbox, cn } from '@ui';

export function SendAsGroupToggle(props: {
  on: boolean;
  locked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Checkbox
      checked={props.on}
      disabled={props.locked}
      onChange={props.onChange}
      class={cn(
        'items-start touch:min-h-[44px]',
        props.locked ? 'cursor-not-allowed' : 'cursor-default'
      )}
    >
      <Checkbox.Control class="mt-0.5" />
      <div class="flex flex-col text-sm">
        <Checkbox.Label
          class={cn(
            'font-medium after:absolute after:inset-0',
            props.locked && 'text-ink-disabled/50'
          )}
        >
          Send As Group Message
        </Checkbox.Label>
        <Checkbox.Description
          class={cn(
            'text-xs mt-0.5',
            props.locked ? 'text-ink-disabled/50' : 'text-ink-muted'
          )}
        >
          {props.on
            ? 'Creates a new group message with all recipients'
            : 'Send a message to each recipient'}
        </Checkbox.Description>
      </div>
    </Checkbox>
  );
}
