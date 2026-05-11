import { Tooltip } from '@ui';
import { UserTooltip } from '@core/component/UserTooltip';
import { emailToMacroId } from '@core/user';
import { createSignal, type JSX } from 'solid-js';

interface Recipient {
  name?: string | null;
  email?: string | null;
}

interface EmailUserTooltipProps {
  recipient?: Recipient | null;
  children: JSX.Element;
  bold?: boolean;
}

export function EmailUserTooltip(props: EmailUserTooltipProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <Tooltip placement="bottom" open={open()} onOpenChange={setOpen}>
      <Tooltip.Trigger as="span">{props.children}</Tooltip.Trigger>
      <Tooltip.Content>
        <UserTooltip
          displayName={props.recipient?.name ?? props.recipient?.email ?? ''}
          email={props.recipient?.email ?? undefined}
          id={
            props.recipient?.email
              ? emailToMacroId(props.recipient.email)
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      </Tooltip.Content>
    </Tooltip>
  );
}
