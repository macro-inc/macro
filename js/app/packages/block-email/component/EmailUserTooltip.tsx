import { Tooltip } from '@core/component/Tooltip';
import { UserTooltip } from '@core/component/UserTooltip';
import { emailToMacroId } from '@core/user';
import type { JSX } from 'solid-js';

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
  return (
    <Tooltip
      placement="bottom"
      unstyled
      spanMode
      tooltip={
        <UserTooltip
          displayName={props.recipient?.name ?? props.recipient?.email ?? ''}
          email={props.recipient?.email ?? undefined}
          id={
            props.recipient?.email
              ? emailToMacroId(props.recipient.email)
              : undefined
          }
        />
      }
    >
      {props.children}
    </Tooltip>
  );
}
